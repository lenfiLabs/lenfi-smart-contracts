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
  CollateralMint,
  CollateralSpend,
  DelayedMergeSpend,
} from "./../../plutus.ts";
import { stakeCredentialOf, UTxO, Validator } from "translucent-cardano";
interface GroupedLoans {
  [poolTokenName: string]: LoanDetails[];
}
interface RepayArgs {
  loanDetails: LoanDetails[];
}

export async function makeMergeRepay(
  lucid: Translucent,
  tx: Tx,
  now: number,
  { loanDetails }: RepayArgs,
  { validators, deployedValidators }: ValidatorRefs,
  order: OutputReference | null = null
) {
  const validityRange: ValidityRange = await getValidityRange(lucid, now);
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
  let mergeOutputs: bigint[] = [];

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
    const poolDatumMapped = poolArtifacts.poolDatumMapped;

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
              poolDatumMapped.params.loanCs.policyId,
              poolDatumMapped.params.loanCs.assetName
            )]: feeAmount,
          }
        );
        outputRef += 1n;
      }


      const amountToRepay =
        collateralDatumMapped.loanAmount + BigInt(accumulatedInterest);

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

      const collateralRedeemer: CollateralSpend["redeemer"] = {
        wrapper: {
          action: "CollateralRepay",
          interest: BigInt(accumulatedInterest),
          mergeType: {
            DelayedIntoPool: [
              {
                outputIndex: BigInt(0) + index + outputRef ,
                amountRepaying: amountToRepay,
              },
            ],
          },
        },
      };
      mergeOutputs.push(index + outputRef)

      borrowerNftsToBurn.push({ tokenName: collateralDatumMapped.borrowerTn });

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
  }

  const metadata = {
    msg: ["Lenfi: Repaid loan"],
  };

  interface Burns {
    [key: string]: bigint;
  }

  borrowerNftsToBurn.sort((a, b) => a.tokenName.localeCompare(b.tokenName));

  const burns: Burns = {};
  for (const nft of borrowerNftsToBurn) {
    burns[toUnit(validators.collateralValidatorHash, nft.tokenName)] = -1n;
  }

  const burnRedeemer: CollateralMint["redeemer"] = {
    mints: [],
    burns: borrowerNftsToBurn,
  };

  tx.readFrom([deployedValidators.collateralValidator])
    .attachMetadata(674, metadata)
    .mintAssets(burns, Data.to(burnRedeemer, CollateralMint.redeemer))
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo);

  return { txBuilder: tx, mergeOutputs };
}

export async function repayLoanToMege(
  lucid: Translucent,
  tx: Tx,
  now: number,
  { loanDetails }: RepayArgs,
  { validators, deployedValidators }: ValidatorRefs
) {
  return await makeMergeRepay(
    lucid,
    tx,
    now,
    {
      loanDetails,
    },
    {
      validators,
      deployedValidators,
    }
  );
}
