import { Data, toUnit, Translucent, Constr, Tx } from "translucent-cardano";
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
import { CollateralMint, CollateralSpend, PoolSpend } from "./../../plutus.ts";
import { stakeCredentialOf, UTxO, Validator } from "translucent-cardano";
interface GroupedLoans {
  [poolTokenName: string]: LoanDetails[];
}
interface RepayArgs {
  loanDetails: LoanDetails[];
}

export async function makeRepay(
  lucid: Translucent,
  tx: Tx,
  now: number,
  loanDetails: LoanDetails[],
  { validators, deployedValidators }: ValidatorRefs,
  order: OutputReference | null = null,
  fakeMint: boolean = false
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
    let amountToRepay = 0n;
    let laonAmount = 0n;
    let outputRef = 0n;

    // Parse every loan used in the pool
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

      amountToRepay += collateralDatumMapped.loanAmount + accumulatedInterest;

      laonAmount += collateralDatumMapped.loanAmount;

      const collateralRedeemer: CollateralSpend["redeemer"] = {
        wrapper: {
          action: "CollateralRepay",
          interest: accumulatedInterest,
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

      borrowerNftsToBurn.push({ tokenName: collateralDatumMapped.borrowerTn });
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
                loanAmount: laonAmount,
                repayAmount: amountToRepay,
                continuingOutput: 0n + outputRef,
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
      amountToRepay +
      poolArtifacts.poolConfigDatum.poolFee;
    poolDatumMapped.lentOut = poolDatumMapped.lentOut - laonAmount;

    tx.collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
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
  }

  const metadata = {
    msg: ["Lenfi: Repaid loan"],
  };

  const referenceScriptUtxo = [
    deployedValidators["poolValidator"],
    deployedValidators["collateralValidator"],
  ];

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

  tx.readFrom(referenceScriptUtxo)
    .attachMetadata(674, metadata)
    .mintAssets(burns, Data.to(burnRedeemer, CollateralMint.redeemer))
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo);

  if (fakeMint) {
    const mints: Burns = {};

    for (const nft of borrowerNftsToBurn) {
      mints[toUnit(validators.collateralValidatorHash, nft.tokenName)] = 1n;
    }
    tx.mintAssets(mints, Data.to(burnRedeemer, CollateralMint.redeemer));
  }
  return { txBuilder: tx };
}

export async function repayLoan(
  lucid: Translucent,
  tx: Tx,
  now: number,
  loanDetails: LoanDetails[],
  { validators, deployedValidators }: ValidatorRefs,
  fakeMint: boolean = false
) {
  return await makeRepay(
    lucid,
    tx,
    now,
    loanDetails,
    {
      validators,
      deployedValidators,
    },
    null,
    fakeMint
  );
}
