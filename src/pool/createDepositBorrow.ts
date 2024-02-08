import {
  Data,
  Translucent,
  stakeCredentialOf,
  toUnit,
  Tx,
  UTxO,
  Validator,
} from "translucent-cardano";
import {
  LpTokenCalculation,
  OutputReference,
  ValidityRange,
} from "../types.ts";
import {
  calculateLpTokens,
  getOutputReference,
  nameFromUTxO,
  PoolArtifacts,
  ValidatorRefs,
} from "../util.ts";
import {
  CollateralMint,
  CollateralSpend,
  LiquidityTokenLiquidityToken,
  OracleValidatorWithdrawValidate,
  PlaceholderNftPlaceholderNft,
  PoolConfigSpend,
  PoolMint,
  PoolSpend,
  PoolStakePoolStake,
} from "../../plutus.ts";

import {
  getInterestRates,
  getPoolArtifacts,
  getValidityRange,
  toUnitOrLovelace,
} from "../util.ts";
import { defaultConfig } from "../constants.ts";

interface BorrowArgs {
  loanAmount: bigint;
  collateralAmount: bigint;
  poolTokenName: string;
  poolStakeValidator: Validator;
  poolTokenName2: string;
  poolStakeValidator2: Validator;
  collateralOracleValidator: Validator;
  loanOracleValidator: Validator;
  loanToken: string;
  collateralToken: string;
  loanOracleDetails?: OracleValidatorWithdrawValidate["redeemer"];
  collateralOracleDetails?: OracleValidatorWithdrawValidate["redeemer"];
}

interface BorrowInternalArgs extends BorrowArgs {
  poolArtifacts: PoolArtifacts;
  borrowerTokenName: string;
}

export async function makeCreateDepositBorrow(
  lucid: Translucent,
  tx: Tx,
  continuingOutputIdx: bigint,
  now: number,
  {
    loanAmount,
    collateralAmount,
    poolTokenName,
    poolStakeValidator,
    poolTokenName2,
    poolStakeValidator2,
    collateralOracleValidator,
    loanOracleValidator,
    poolArtifacts,
    borrowerTokenName,
    loanToken,
    collateralToken,
    loanOracleDetails,
    collateralOracleDetails,
  }: BorrowInternalArgs,
  { validators, deployedValidators }: ValidatorRefs,
  order: OutputReference | null = null
) {
  let producedOutputIdx = 0n;

  // CREATE POOL PART
  const utxos = await lucid.wallet.getUtxos();
  const utxoToConsume = utxos[utxos.length - 1];
  const depositAmount = 10000000n;
  const lpTokensMinted = depositAmount;
  const uniqueNftName = nameFromUTxO(utxoToConsume);
  const initialOutputRef: OutputReference = {
    transactionId: { hash: utxoToConsume.txHash },
    outputIndex: BigInt(utxoToConsume.outputIndex),
  };
  const stakingValidator = new PoolStakePoolStake(
    validators.poolScriptHash,
    { policyId: validators.delegatorNftPolicyId, assetName: uniqueNftName },
    initialOutputRef
  );
  const stakeKeyHash = lucid.utils.validatorToScriptHash(stakingValidator);
  const newPoolrewardsAddress =
    lucid.utils.validatorToRewardAddress(stakingValidator);

  const lpTokenPolicy = new LiquidityTokenLiquidityToken(
    validators.poolScriptHash,
    stakeKeyHash
  );

  const delegateToPoolId =
    "pool1n84mel6x3e8sp0jjgmepme0zmv8gkw8chs98sqwxtruvkhhcsg8";
  const delegateToPoolHash =
    "99ebbcff468e4f00be5246f21de5e2db0e8b38f8bc0a7801c658f8cb";

  const withdrawRedeemer: PoolStakePoolStake["redeemer"] = {
    CreatePool: [initialOutputRef],
  };

  const lpTokenPolicyId = lucid.utils.validatorToScriptHash(lpTokenPolicy);

  const newPoolDatum: PoolSpend["datum"] = {
    params: {
      collateralAddress: {
        paymentCredential: {
          ScriptCredential: [validators.collateralValidatorHash],
        },
        stakeCredential: {
          Inline: [
            {
              ScriptCredential: [stakeKeyHash],
            },
          ],
        },
      },
      loanCs: {
        policyId: loanToken.substring(0, 56),
        assetName: loanToken.substring(56),
      },
      collateralCs: {
        policyId: collateralToken.substring(0, 56),
        assetName: collateralToken.substring(56),
      },
      oracleCollateralAsset: {
        policyId: "",
        assetName: "",
      },
      oracleLoanAsset: {
        policyId: "",
        assetName: "",
      },
      lpToken: {
        policyId: lpTokenPolicyId,
        assetName: stakeKeyHash,
      },
      poolNftName: stakeKeyHash,
      poolConfigAssetname: uniqueNftName,
    },
    balance: BigInt(depositAmount),
    lentOut: BigInt(0),
    totalLpTokens: BigInt(lpTokensMinted),
  };

  const delegatorNftRedeemer: PlaceholderNftPlaceholderNft["r"] = {
    action: {
      MintNFT: [
        {
          transactionId: {
            hash: utxoToConsume.txHash,
          },
          outputIndex: BigInt(utxoToConsume.outputIndex),
        },
        producedOutputIdx,
      ],
    },
    inner: undefined,
  };

  const poolNftRedeemer: PoolMint["redeemer"] = {
    MintPoolNFT: [
      {
        outputIndex: producedOutputIdx,
        initialPoolDelegation: delegateToPoolHash,
      },
    ],
  };

  const lpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
    CreatePool: {
      producedOutput: 0n,
    },
  };

  const newPoolContractAddress = lucid.utils.validatorToAddress(
    validators.poolValidator,
    stakeCredentialOf(newPoolrewardsAddress)
  );

  const poolConfigValidatorAddress = lucid.utils.validatorToAddress(
    validators.poolConfigValidator
  );

  const lpUnit = toUnit(lpTokenPolicyId, stakeKeyHash);
  const poolNft = toUnit(validators.poolScriptHash, stakeKeyHash);
  const delegatorNft = toUnit(validators.delegatorNftPolicyId, uniqueNftName);
  const configNft = toUnit(validators.poolConfigPolicyId, uniqueNftName);

  let txBuilder = tx
    .collectFrom([utxoToConsume])
    .mintAssets(
      {
        [poolNft]: BigInt(1),
      },
      Data.to(poolNftRedeemer, PoolMint["redeemer"])
    )
    .payToAddressWithData(
      newPoolContractAddress,
      { inline: Data.to(newPoolDatum, PoolSpend.datum) },
      {
        [toUnitOrLovelace(loanToken.substring(0, 56), loanToken.substring(56))]:
          depositAmount,
        [poolNft]: BigInt(1),
      }
    )
    .attachMintingPolicy(lpTokenPolicy)
    .mintAssets(
      {
        [lpUnit]: BigInt(lpTokensMinted),
      },
      Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
    )
    .readFrom([deployedValidators.delegatorNftPolicy])
    .mintAssets(
      {
        [delegatorNft]: BigInt(1),
      },
      Data.to(delegatorNftRedeemer, PlaceholderNftPlaceholderNft.r)
    )
    .readFrom([deployedValidators.poolConfigNftPolicy])
    .mintAssets(
      {
        [configNft]: BigInt(1),
      },
      Data.to(delegatorNftRedeemer, PlaceholderNftPlaceholderNft.r)
    )
    .payToAddressWithData(
      poolConfigValidatorAddress,
      { inline: Data.to(defaultConfig, PoolConfigSpend.datum) },
      {
        [configNft]: 1n,
      }
    )
    .registerStake(newPoolrewardsAddress)
    .delegateTo(
      newPoolrewardsAddress,
      delegateToPoolId,
      Data.to(withdrawRedeemer, PoolStakePoolStake.redeemer)
    )
    .attachCertificateValidator(stakingValidator);

  // BORROW STUFF
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

  const borrowPoolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            Borrow: {
              loanAmount: BigInt(loanAmount),
              collateralAmount: BigInt(collateralAmount),
              borrowerTn: borrowerTokenName,
              interestRate: BigInt(interestRate),
              continuingOutput: continuingOutputIdx + 2n,
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
        outputPointer: producedOutputIdx + 3n,
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

  txBuilder
    .readFrom([deployedValidators.poolValidator])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(borrowPoolRedeemer, PoolSpend.redeemer)
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

  // DEPOSIT STUFF
  const anDepositAmount = 50000000n;
  const depositRewardsAddress =
    lucid.utils.validatorToRewardAddress(poolStakeValidator2);

  const depositPoolAddress = lucid.utils.validatorToAddress(
    validators.poolValidator,
    stakeCredentialOf(depositRewardsAddress)
  );

  const depositPoolArtifacts = await getPoolArtifacts(
    poolTokenName2,
    validators,
    lucid
  );

  const depositPoolDatumMapped = depositPoolArtifacts.poolDatumMapped;
  const depositPoolConfigDatum = depositPoolArtifacts.poolConfigDatum;

  const depositLpTokenPolicy = new LiquidityTokenLiquidityToken(
    validators.poolScriptHash,
    poolTokenName2
  );

  const lpTokensToDepositDetails: LpTokenCalculation = calculateLpTokens(
    depositPoolDatumMapped.balance,
    depositPoolDatumMapped.lentOut,
    anDepositAmount,
    depositPoolDatumMapped.totalLpTokens
  );

  const lpTokensToDeposit = lpTokensToDepositDetails.lpTokenMintAmount;
  if (lpTokensToDepositDetails.lpTokenMintAmount > anDepositAmount) {
    throw "User wants more LPs than allowed";
  }

  depositPoolDatumMapped.balance =
    depositPoolDatumMapped.balance +
    lpTokensToDepositDetails.depositAmount +
    depositPoolConfigDatum.poolFee;

  depositPoolDatumMapped.totalLpTokens =
    depositPoolDatumMapped.totalLpTokens + lpTokensToDeposit;

  const depositPoolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            LpAdjust: {
              valueDelta: lpTokensToDepositDetails.depositAmount,
              continuingOutput: continuingOutputIdx + 4n,
            },
          },
        ],
      },
      configRef: getOutputReference(depositPoolArtifacts.configUTxO),
      order,
    },
  };

  const depositLpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
    TransitionPool: {
      poolOref: getOutputReference(depositPoolArtifacts.poolUTxO),
      continuingOutput: continuingOutputIdx + 4n,
    },
  };
  const depositLpTokenPolicyId =
    lucid.utils.validatorToScriptHash(depositLpTokenPolicy);

  txBuilder
    .payToAddressWithData(
      depositPoolAddress,
      { inline: Data.to(depositPoolDatumMapped, PoolSpend.datum) },
      {
        [toUnitOrLovelace(
          depositPoolDatumMapped.params.loanCs.policyId,
          depositPoolDatumMapped.params.loanCs.assetName
        )]: depositPoolDatumMapped.balance,
        [toUnit(validators.poolScriptHash, poolTokenName2)]: BigInt(1),
      }
    )
    .readFrom([depositPoolArtifacts.configUTxO])
    .collectFrom(
      [depositPoolArtifacts.poolUTxO],
      Data.to(depositPoolRedeemer, PoolSpend.redeemer)
    )
    .attachMintingPolicy(depositLpTokenPolicy)
    .mintAssets(
      {
        [toUnit(depositLpTokenPolicyId, poolTokenName2)]:
          BigInt(lpTokensToDeposit),
      },
      Data.to(depositLpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
    );

  return { txBuilder, borrowerTokenName };
}

export async function createDepositBorrow(
  lucid: Translucent,
  tx: Tx,
  continuingOutputIdx: bigint,
  now: number,
  {
    loanAmount,
    collateralAmount,
    poolTokenName,
    poolStakeValidator,
    poolTokenName2,
    poolStakeValidator2,
    collateralOracleValidator,
    loanOracleValidator,
    loanToken,
    collateralToken,
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

  return await makeCreateDepositBorrow(
    lucid,
    tx,
    continuingOutputIdx,
    now,
    {
      loanAmount,
      collateralAmount,
      poolTokenName,
      poolStakeValidator,
      poolTokenName2,
      poolStakeValidator2,
      collateralOracleValidator,
      loanOracleValidator,
      loanOracleDetails,
      collateralOracleDetails,
      poolArtifacts,
      borrowerTokenName,
      loanToken,
      collateralToken,
    },
    {
      validators,
      deployedValidators,
    }
  );
}
