import {
  C,
  Data,
  fromHex,
  Translucent,
  stakeCredentialOf,
  toHex,
  toUnit,
  Tx,
  UTxO,
  Validator,
} from "translucent-cardano";
import {
  OutputReference,
  PriceFeed,
  ValidityRange,
} from "./../../src/types.ts";
import {
  nameFromUTxO,
  PoolArtifacts,
  ValidatorRefs,
} from "./../../src/util.ts";
import {
  CollateralMint,
  CollateralSpend,
  OracleValidatorWithdrawValidate,
  PoolSpend,
} from "./../../plutus.ts";

import {
  getInterestRates,
  getPoolArtifacts,
  getValidityRange,
  toUnitOrLovelace,
} from "./../util.ts";
// import { defaultConfig } from "./../constants.ts";

interface BorrowArgs {
  loanAmount: bigint;
  collateralAmount: bigint;
  poolTokenName: string;
  poolStakeValidator: Validator;
  collateralOracleValidator: Validator;
  loanOracleValidator: Validator;
  loanOracleDetails?: OracleValidatorWithdrawValidate["redeemer"];
  collateralOracleDetails?: OracleValidatorWithdrawValidate["redeemer"];
}

interface BorrowInternalArgs extends BorrowArgs {
  poolArtifacts: PoolArtifacts;
  borrowerTokenName: string;
}

export async function makeBorrow(
  lucid: Translucent,
  tx: Tx,
  continuingOutputIdx: bigint,
  now: number,
  {
    loanAmount,
    collateralAmount,
    poolTokenName,
    poolStakeValidator,
    collateralOracleValidator,
    loanOracleValidator,
    poolArtifacts,
    borrowerTokenName,
    loanOracleDetails,
    collateralOracleDetails,
  }: BorrowInternalArgs,
  { validators, deployedValidators }: ValidatorRefs,
  order: OutputReference | null = null
) {
  const validityRange: ValidityRange = getValidityRange(lucid, now);
  const rewardsAddress =
    lucid.utils.validatorToRewardAddress(poolStakeValidator);

  const poolContractAddress = lucid.utils.validatorToAddress(
    validators.poolValidator,
    stakeCredentialOf(rewardsAddress)
  );

  const collateralContractAddress = lucid.utils.validatorToAddress(
    validators.collateralValidator,
    stakeCredentialOf(rewardsAddress)
  );

  const poolDatumMapped = poolArtifacts.poolDatumMapped;
  const poolConfigDatum = poolArtifacts.poolConfigDatum;

  if (loanAmount < poolConfigDatum.minLoan) {
    throw new Error("Loan amount is too low");
  }

  poolDatumMapped.balance =
    poolDatumMapped.balance - loanAmount + poolConfigDatum.poolFee;
  poolDatumMapped.lentOut = poolDatumMapped.lentOut + loanAmount;

  let interestRate = getInterestRates(
    poolConfigDatum.interestParams,
    loanAmount,
    poolDatumMapped.lentOut,
    poolDatumMapped.balance
  );

  interestRate = interestRate;

  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            Borrow: {
              loanAmount: BigInt(loanAmount),
              collateralAmount: BigInt(collateralAmount),
              borrowerTn: borrowerTokenName,
              interestRate: BigInt(interestRate),
              continuingOutput: continuingOutputIdx,
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

  const borrowerTokenRedeemer: CollateralMint["redeemer"] = {
    mints: [
      {
        outputReference: {
          transactionId: { hash: poolArtifacts.poolUTxO.txHash },
          outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
        },
        outputPointer: 1n,
      },
    ],
    burns: [],
  };

  const collateralData: CollateralSpend["datum"] = {
    poolNftName: poolDatumMapped.params.poolNftName,
    loanCs: poolDatumMapped.params.loanCs,
    loanAmount: BigInt(loanAmount),
    poolConfig: poolArtifacts.poolConfigDatum, // TODO: This is not correct
    collateralCs: poolDatumMapped.params.collateralCs,
    collateralAmount: BigInt(collateralAmount),
    interestRate: interestRate,
    depositTime: BigInt(validityRange.validFrom),
    borrowerTn: borrowerTokenName,
    oracleCollateralAsset: poolDatumMapped.params.oracleCollateralAsset,
    oracleLoanAsset: poolDatumMapped.params.oracleLoanAsset,
    tag: order,
    lentOut: poolDatumMapped.lentOut - loanAmount,
    balance: poolDatumMapped.balance + loanAmount - poolConfigDatum.poolFee,
  };

  const metadata = {
    msg: ["Lenfi: Borrowed from pool"],
  };

  // Oracle is not needed for ADA!
  let oracleUtxos: UTxO[] = [];
  let oracleValidators: {
    rewardAddress: string;
    validator: Validator;
    redeemer: OracleValidatorWithdrawValidate["redeemer"];
  }[] = [];

  if (
    poolDatumMapped.params.loanCs.policyId !== "" &&
    loanOracleDetails != null
  ) {
    const loanOracleUtxo: UTxO = await lucid.provider.getUtxoByUnit(
      toUnit(
        poolDatumMapped.params.oracleLoanAsset.policyId,
        poolDatumMapped.params.oracleLoanAsset.assetName
      )
    );
    // Collect oracle signature
    oracleUtxos.push(loanOracleUtxo);
    oracleValidators.push({
      validator: loanOracleValidator,
      rewardAddress: lucid.utils.validatorToRewardAddress(loanOracleValidator),
      redeemer: loanOracleDetails,
    });
  }

  if (
    poolDatumMapped.params.collateralCs.policyId !== "" &&
    collateralOracleDetails != null
  ) {
    const oracleCollaterallAsset =
      poolDatumMapped.params.oracleCollateralAsset.policyId +
      poolDatumMapped.params.oracleCollateralAsset.assetName;

    const collateralOracleUtxo: UTxO = await lucid.provider.getUtxoByUnit(
      oracleCollaterallAsset
    );

    // Collect oracle signature
    oracleUtxos.push(collateralOracleUtxo);
    oracleValidators.push({
      validator: collateralOracleValidator,
      rewardAddress: lucid.utils.validatorToRewardAddress(
        collateralOracleValidator
      ),
      redeemer: collateralOracleDetails,
    });
  }

  const valueToSendToPool = {
    [toUnit(validators.poolScriptHash, poolTokenName)]: 1n,
  };

  if (poolDatumMapped.balance > 0n) {
    valueToSendToPool[
      toUnitOrLovelace(
        poolDatumMapped.params.loanCs.policyId,
        poolDatumMapped.params.loanCs.assetName
      )
    ] = BigInt(poolDatumMapped.balance);
  }

  const txBuilder = tx
    .readFrom([deployedValidators.poolValidator])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .payToContract(
      poolContractAddress,
      { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
      valueToSendToPool
    )
    .payToContract(
      collateralContractAddress,
      { inline: Data.to(collateralData, CollateralSpend.datum) },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.collateralCs.policyId,
          poolDatumMapped.params.collateralCs.assetName
        )]: BigInt(collateralAmount),
      }
    )
    .readFrom([deployedValidators.collateralValidator])
    .mintAssets(
      {
        [toUnit(validators.collateralValidatorHash, borrowerTokenName)]: 1n,
      },
      Data.to(borrowerTokenRedeemer, CollateralMint.redeemer)
    )
    .readFrom([poolArtifacts.configUTxO])
    .validFrom(validityRange.validFrom)
    .readFrom(oracleUtxos)
    .validTo(validityRange.validTo)
    .attachMetadata(674, metadata);

  oracleValidators.forEach(async (oracle) => {
    tx.withdraw(
      oracle.rewardAddress,
      0n,
      Data.to(oracle.redeemer, OracleValidatorWithdrawValidate.redeemer)
    ).attachWithdrawalValidator(oracle.validator);
  });

  return { txBuilder, borrowerTokenName };
}

export async function borrowFromPool(
  lucid: Translucent,
  tx: Tx,
  continuingOutputIdx: bigint,
  now: number,
  {
    loanAmount,
    collateralAmount,
    poolTokenName,
    poolStakeValidator,
    collateralOracleValidator,
    loanOracleValidator,
    loanOracleDetails,
    collateralOracleDetails,
  }: BorrowArgs,
  { validators, deployedValidators }: ValidatorRefs
) {
  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );

  const borrowerTokenName = nameFromUTxO(poolArtifacts.poolUTxO);

  return await makeBorrow(
    lucid,
    tx,
    continuingOutputIdx,
    now,
    {
      loanAmount,
      collateralAmount,
      poolTokenName,
      poolStakeValidator,
      collateralOracleValidator,
      loanOracleValidator,
      loanOracleDetails,
      collateralOracleDetails,
      poolArtifacts,
      borrowerTokenName,
    },
    {
      validators,
      deployedValidators,
    }
  );
}
