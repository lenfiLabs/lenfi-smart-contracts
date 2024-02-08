import { Data, toUnit, Translucent, Tx } from "translucent-cardano";
import {
  calculateInterestAmount,
  generateReceiverAddress,
  getPlatformFee,
  getPoolArtifacts,
  getValidityRange,
  toUnitOrLovelace,
  ValidatorRefs,
} from "./../util.ts";
import { LoanDetails, OutputReference, ValidityRange } from "./../types.ts";
import {
  CollateralSpend,
  DelayedMergeSpend,
  OracleValidatorWithdrawValidate,
} from "./../../plutus.ts";
import { stakeCredentialOf, UTxO, Validator } from "translucent-cardano";
interface GroupedLoans {
  [poolTokenName: string]: LoanDetails[];
}
interface RepayArgs {
  loanDetails: LoanDetails[];
}

export async function poolLiquidateMerge(
  lucid: Translucent,
  tx: Tx,
  now: number,
  { loanDetails }: RepayArgs,
  { validators, deployedValidators }: ValidatorRefs,
  order: OutputReference | null = null
) {
  const validityRange: ValidityRange = getValidityRange(lucid, now);
  // Group loans by poolTokenName
  const loansGroupedByPool: GroupedLoans = loanDetails.reduce(
    (acc: GroupedLoans, loan) => {
      const groupName = loan.poolTokenName;
      if (!acc[groupName]) {
        acc[groupName] = [];
      }
      acc[groupName].push(loan);
      return acc;
    },
    {} as GroupedLoans
  );

  // Parse every pool used in the transaction
  let borrowerNftsToBurn: { tokenName: string }[] = [];
  let oracleUtxos: UTxO[] = [];
  let oracleValidators: {
    rewardAddress: string;
    validator: Validator;
    redeemer: OracleValidatorWithdrawValidate["redeemer"];
  }[] = [];

  for (const [poolTokenName, loans] of Object.entries(loansGroupedByPool)) {
    const rewardsAddress = lucid.utils.validatorToRewardAddress(
      loans[0].poolStakeValidator
    );
    const mergeContractAddress = lucid.utils.validatorToAddress(
      validators.mergeScript,
      stakeCredentialOf(rewardsAddress)
    );

    const poolArtifacts = await getPoolArtifacts(
      poolTokenName,
      validators,
      lucid
    );

    // Parse every loan used in the pool
    let outputRef = 0n;
    for (let index = 0n; index < loans.length; index++) {
      const loan = loans[Number(index)];
      const utxoToConsumeCollateral: UTxO[] = await lucid.utxosByOutRef([
        {
          txHash: loan.loanUtxo.txHash,
          outputIndex: loan.loanUtxo.outputIndex,
        },
      ]);

      const collateralDatumMapped: CollateralSpend["datum"] =
        await lucid.datumOf(utxoToConsumeCollateral[0], CollateralSpend.datum);

      const accumulatedInterest = calculateInterestAmount(
        collateralDatumMapped.interestRate,
        collateralDatumMapped.loanAmount,
        collateralDatumMapped.depositTime,
        validityRange.validTo
      );

      const platformFee = getPlatformFee(
        collateralDatumMapped,
        poolArtifacts.poolConfigDatum
      );
      // Pay platform fee if needed
      if (platformFee > 0n) {
        const datum = Data.to(collateralDatumMapped.borrowerTn);

        let feeAmount = (accumulatedInterest * platformFee) / 1000000n;
        feeAmount =
          feeAmount < poolArtifacts.poolConfigDatum.minFee
            ? feeAmount
            : poolArtifacts.poolConfigDatum.minFee;

        const fee_receiver_address = generateReceiverAddress(
          lucid,
          poolArtifacts.poolConfigDatum.loanFeeDetails
            .platformFeeCollectorAddress
        );

        tx.payToContract(
          fee_receiver_address,
          {
            inline: datum,
          },
          {
            [toUnitOrLovelace(
              poolArtifacts.poolDatumMapped.params.loanCs.policyId,
              poolArtifacts.poolDatumMapped.params.loanCs.assetName
            )]: platformFee,
          }
        );
        outputRef += 1n;
      }

      const amountToRepay =
        collateralDatumMapped.loanAmount + BigInt(accumulatedInterest);

      const collateralRedeemer: CollateralSpend["redeemer"] = {
        wrapper: {
          action: { CollateralLiquidate: [BigInt(index)] },
          interest: BigInt(accumulatedInterest),
          mergeType: {
            DelayedIntoPool: [
              {
                outputIndex: BigInt(0) + index + outputRef,
                amountRepaying: amountToRepay,
              },
            ],
          },
        },
      };

      const mergeDatum: DelayedMergeSpend["_datum"] = {
        borrowerTn: loan.borrowerTokenName,
        poolNftName: collateralDatumMapped.poolNftName,
        repayAmount: amountToRepay,
        loanAmount: collateralDatumMapped.loanAmount,
        collateralOref: {
          transactionId: { hash: utxoToConsumeCollateral[0].txHash },
          outputIndex: BigInt(utxoToConsumeCollateral[0].outputIndex),
        },
      };

      borrowerNftsToBurn.push({ tokenName: collateralDatumMapped.borrowerTn });

      if (
        collateralDatumMapped.loanCs.policyId !== "" &&
        loan.loanOracleDetails != null &&
        loan.loanOracleValidator != null
      ) {
        const oracleLoanlAsset =
          collateralDatumMapped.oracleLoanAsset.policyId +
          collateralDatumMapped.oracleLoanAsset.assetName;
        const loanOracleUtxo: UTxO =
          await lucid.provider.getUtxoByUnit(oracleLoanlAsset);

        // Collect oracle signature
        oracleUtxos.push(loanOracleUtxo);
        oracleValidators.push({
          validator: loan.loanOracleValidator,
          rewardAddress: lucid.utils.validatorToRewardAddress(
            loan.loanOracleValidator
          ),
          redeemer: loan.loanOracleDetails,
        });
      }

      if (
        collateralDatumMapped.collateralCs.policyId !== "" &&
        loan.collateralOracleDetails != null &&
        loan.collateralOracleValidator != null
      ) {
        const oracleCollaterallAsset =
          collateralDatumMapped.oracleCollateralAsset.policyId +
          collateralDatumMapped.oracleCollateralAsset.assetName;

        const collateralOracleUtxo: UTxO = await lucid.provider.getUtxoByUnit(
          oracleCollaterallAsset
        );

        oracleUtxos.push(collateralOracleUtxo);
        oracleValidators.push({
          validator: loan.collateralOracleValidator,
          rewardAddress: lucid.utils.validatorToRewardAddress(
            loan.collateralOracleValidator
          ),
          redeemer: loan.collateralOracleDetails,
        });
      }

      // For every loan
      tx.collectFrom(
        utxoToConsumeCollateral,
        Data.to(collateralRedeemer, CollateralSpend.redeemer)
      ).payToContract(
        mergeContractAddress,
        {
          inline: Data.to(mergeDatum, DelayedMergeSpend._datum),
        },
        {
          [toUnitOrLovelace(
            collateralDatumMapped.loanCs.policyId,
            collateralDatumMapped.loanCs.assetName
          )]: amountToRepay + collateralDatumMapped.poolConfig.mergeActionFee,
        }
      );
    }

    const uniqueOracleValidators = oracleValidators.filter(
      (obj, index, self) => {
        const uniqueKey = obj.redeemer.signatures;
        return (
          index === self.findIndex((t) => t.redeemer.signatures === uniqueKey)
        );
      }
    );

    uniqueOracleValidators.forEach(async (oracle) => {
      tx.withdraw(
        oracle.rewardAddress,
        0n,
        Data.to(oracle.redeemer, OracleValidatorWithdrawValidate.redeemer)
      ).attachWithdrawalValidator(oracle.validator);
    });

    tx.readFrom(oracleUtxos).readFrom([deployedValidators.collateralValidator]);
  }

  const metadata = {
    msg: ["Lenfi: Liquidated loan"],
  };

  tx.readFrom([deployedValidators.collateralValidator])
    .readFrom([deployedValidators.poolValidator])
    .attachMetadata(674, metadata)
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo);

  return { txBuilder: tx };
}
