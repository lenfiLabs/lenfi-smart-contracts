import { Data, toUnit, Translucent, Tx } from "translucent-cardano";
import {
  assetGainAdaSale,
  calculateCollateralValue,
  calculateInterestAmount,
  calculateLoanValue,
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
  LeftoversLeftovers,
  OracleValidatorWithdrawValidate,
  PoolSpend,
} from "./../../plutus.ts";
import { stakeCredentialOf, UTxO, Validator } from "translucent-cardano";
import BigNumber from "bignumber.js";
interface GroupedLoans {
  [poolTokenName: string]: LoanDetails[];
}
interface RepayArgs {
  loanDetails: LoanDetails[];
  ignoreBorrower?: boolean;
}

export async function poolLiquidate(
  lucid: Translucent,
  tx: Tx,
  now: number,
  { loanDetails, ignoreBorrower = false }: RepayArgs,
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
  let borrowerCompensationExists = false;
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
    const poolContractAddress = lucid.utils.validatorToAddress(
      validators.poolValidator,
      stakeCredentialOf(rewardsAddress)
    );

    const poolArtifacts = await getPoolArtifacts(
      poolTokenName,
      validators,
      lucid
    );
    const poolDatumMapped = poolArtifacts.poolDatumMapped;

    // You can access each loan in the loans array and perform operations on them
    let poolAmountToRepay = 0n;
    let poolLaonAmount = 0n;

    // Parse every loan used in the pool
    let borrowerCompensationIndex = 0n;
    let outputRef = 0n;

    for (const loan of loans) {
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

      const loanDebt =
        BigInt(collateralDatumMapped.loanAmount) + BigInt(accumulatedInterest);
      poolAmountToRepay += loanDebt;
      poolLaonAmount += BigInt(collateralDatumMapped.loanAmount);

      const collateralRedeemer: CollateralSpend["redeemer"] = {
        wrapper: {
          action: {
            CollateralLiquidate: [borrowerCompensationIndex + outputRef],
          },
          interest: BigInt(accumulatedInterest),
          mergeType: {
            ImmediateWithPool: [
              {
                transactionId: {
                  hash: poolArtifacts.poolUTxO.txHash,
                },
                outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
              },
            ],
          },
        },
      };

      // // Figure out loan and collateral  values
      let debtValueInAda = 0n;
      let collateralValueInAda = 0n;

      ({ debtValueInAda, oracleUtxos, oracleValidators } =
        await calculateLoanValue(
          poolDatumMapped,
          collateralDatumMapped,
          loan,
          accumulatedInterest,
          lucid,
          oracleUtxos,
          oracleValidators
        ));

      ({ collateralValueInAda, oracleUtxos, oracleValidators } =
        await calculateCollateralValue(
          poolDatumMapped,
          collateralDatumMapped,
          loan,
          lucid,
          oracleUtxos,
          oracleValidators
        ));

      borrowerNftsToBurn.push({ tokenName: collateralDatumMapped.borrowerTn });

      const feePercentage = new BigNumber(
        Number(collateralDatumMapped.poolConfig.loanFeeDetails.liquidationFee)
      );

      const feeAmount = Math.floor(
        new BigNumber(Number(collateralValueInAda))
          .minus(Number(debtValueInAda))
          .multipliedBy(feePercentage)
          .dividedBy(1000000)
          .toNumber()
      );

      const remainingCollateralValue = new BigNumber(
        Number(collateralValueInAda)
      )
        .minus(Number(debtValueInAda))
        .minus(feeAmount);

      let remaminingValueInCollateral = new BigNumber(0);
      if (
        loan.collateralOracleDetails?.data == null ||
        collateralDatumMapped.collateralCs.policyId == ""
      ) {
        remaminingValueInCollateral = remainingCollateralValue;
      } else {
        remaminingValueInCollateral = new BigNumber(
          Number(
            assetGainAdaSale(
              loan.collateralOracleDetails,
              BigInt(Math.floor(Number(remainingCollateralValue.toNumber()))),
              collateralDatumMapped.collateralCs.policyId,
              collateralDatumMapped.collateralCs.assetName
            )
          )
        );
      }

      const healthFactor = new BigNumber(Number(collateralValueInAda))
        .multipliedBy(1000000)
        .dividedBy(Number(debtValueInAda))
        .dividedBy(
          Number(collateralDatumMapped.poolConfig.liquidationThreshold)
        );


      if (
        !ignoreBorrower &&
        remaminingValueInCollateral.gt(0) &&
        healthFactor.lt(1)
      ) {

        const leftoverAddress = lucid.utils.validatorToAddress(
          validators.leftoverValidator,
          stakeCredentialOf(rewardsAddress)
        );

        const liquidationDatum: LeftoversLeftovers["datum"] = {
          policyId: validators.collateralValidatorHash,
          assetName: collateralDatumMapped.borrowerTn,
        };

        tx.payToContract(
          leftoverAddress,
          {
            inline: Data.to(liquidationDatum, LeftoversLeftovers.datum),
          },
          {
            [toUnitOrLovelace(
              poolDatumMapped.params.collateralCs.policyId,
              poolDatumMapped.params.collateralCs.assetName
            )]: BigInt(
              Math.floor(Number(remaminingValueInCollateral.toString()))
            ),
          }
        );
        borrowerCompensationIndex += 1n;
        borrowerCompensationExists = true;
      }

      tx.collectFrom(
        utxoToConsumeCollateral,
        Data.to(collateralRedeemer, CollateralSpend.redeemer)
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
              poolDatumMapped.params.loanCs.policyId,
              poolDatumMapped.params.loanCs.assetName
            )]: platformFee,
          }
        );
        outputRef += 1n;
      }
    }

    // Outside of for loop
    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: {
          Continuing: [
            {
              CloseLoan: {
                loanAmount: poolLaonAmount,
                repayAmount: poolAmountToRepay,
                continuingOutput: 0n + borrowerCompensationIndex + outputRef,
              },
            },
          ],
        },
        configRef: {
          transactionId: { hash: poolArtifacts.configUTxO.txHash },
          outputIndex: BigInt(poolArtifacts.configUTxO.outputIndex),
        },
        order,
      },
    };

    poolDatumMapped.balance =
      poolDatumMapped.balance +
      poolAmountToRepay +
      poolArtifacts.poolConfigDatum.poolFee;
    poolDatumMapped.lentOut = poolDatumMapped.lentOut - poolLaonAmount;

    tx.collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
      .readFrom(oracleUtxos)
      .payToContract(
        poolContractAddress,
        {
          inline: Data.to(poolDatumMapped, PoolSpend.datum),
        },
        {
          [toUnitOrLovelace(
            poolDatumMapped.params.loanCs.policyId,
            poolDatumMapped.params.loanCs.assetName
          )]: poolDatumMapped.balance,
          [toUnit(validators.poolScriptHash, poolTokenName)]: 1n,
        }
      )
      .readFrom([poolArtifacts.configUTxO]);

    const uniqueOracleValidators = oracleValidators.filter(
      (obj, index, self) => {
        const uniqueKey = obj.redeemer.signatures;
        return (
          index === self.findIndex((t) => t.redeemer.signatures === uniqueKey)
        );
      }
    );

    uniqueOracleValidators.forEach(async (oracle) => {
      // console.log("oracle ", oracle);
      tx.withdraw(
        oracle.rewardAddress,
        0n,
        Data.to(oracle.redeemer, OracleValidatorWithdrawValidate.redeemer)
      ).attachWithdrawalValidator(oracle.validator);
    });
  }

  const metadata = {
    msg: ["Lenfi: Liquidated loan"],
  };

  tx.readFrom([deployedValidators.collateralValidator])
    .readFrom([deployedValidators.poolValidator])
    .attachMetadata(674, metadata)
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo);
  return { txBuilder: tx, borrowerCompensationExists };
}
