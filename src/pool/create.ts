import {
  C,
  Data,
  Emulator,
  stakeCredentialOf,
  toUnit,
  Translucent,
  Tx,
} from "translucent-cardano";
import { TokenData } from "./../../src/types.ts";
import {
  nameFromUTxO,
  OutputReference,
  ValidatorRefs,
} from "./../../src/util.ts";

import { defaultConfig } from "./../../src/constants.ts";

import { toUnitOrLovelace } from "./../util.ts";
import {
  LiquidityTokenLiquidityToken,
  PlaceholderNftPlaceholderNft,
  PoolConfigSpend,
  PoolMint,
  PoolSpend,
  PoolStakePoolStake,
} from "./../../plutus.ts";

interface CreatePoolArgs {
  depositAmount: bigint;
  loanToken: string;
  collateralToken: string;
  collateralOracleNft: string;
  loanOracleNft: string;
}

export async function createPool(
  lucid: Translucent,
  tx: Tx,
  producedOutputIdx: bigint,
  {
    depositAmount,
    loanToken,
    collateralToken,
    collateralOracleNft,
    loanOracleNft,
  }: CreatePoolArgs,
  { validators, deployedValidators }: ValidatorRefs
) {
  const utxos = await lucid.wallet.getUtxos();
  const utxoToConsume = utxos[utxos.length - 1];

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
  const rewardsAddress = lucid.utils.validatorToRewardAddress(stakingValidator);
  const poolTokenName = stakeKeyHash;
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

  const poolDatum: PoolSpend["datum"] = {
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
        policyId: collateralOracleNft
          ? collateralOracleNft.substring(0, 56)
          : "",
        assetName: collateralOracleNft ? collateralOracleNft.substring(56) : "",
      },
      oracleLoanAsset: {
        policyId: loanOracleNft ? loanOracleNft.substring(0, 56) : "",
        assetName: loanOracleNft ? loanOracleNft.substring(56) : "",
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
      producedOutput: producedOutputIdx,
    },
  };

  const poolContractAddress = lucid.utils.validatorToAddress(
    validators.poolValidator,
    stakeCredentialOf(rewardsAddress)
  );

  let message = `Aada: Created new pool. Loan; Collateral`;
  if (message.length >= 128) {
    message = "Aada: Created new pool";
  }
  const metadata = {
    msg: [message],
  };

  const poolConfigValidatorAddress = lucid.utils.validatorToAddress(
    validators.poolConfigValidator
  );

  const lpUnit = toUnit(lpTokenPolicyId, stakeKeyHash);
  const poolNft = toUnit(validators.poolScriptHash, stakeKeyHash);
  const delegatorNft = toUnit(validators.delegatorNftPolicyId, uniqueNftName);
  const configNft = toUnit(validators.poolConfigPolicyId, uniqueNftName);

  const txBuilder = tx
    .collectFrom([utxoToConsume])
    .readFrom([deployedValidators.poolValidator])
    .mintAssets(
      {
        [poolNft]: BigInt(1),
      },
      Data.to(poolNftRedeemer, PoolMint["redeemer"])
    )
    .payToAddressWithData(
      poolContractAddress,
      { inline: Data.to(poolDatum, PoolSpend.datum) },
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
    .registerStake(rewardsAddress)
    .delegateTo(
      rewardsAddress,
      delegateToPoolId,
      Data.to(withdrawRedeemer, PoolStakePoolStake.redeemer)
    )
    .registerStake(lucid.utils.validatorToRewardAddress(validators.mergeScript)) // Doing it here so can use merge later.
    .attachCertificateValidator(stakingValidator)
    .attachMetadata(674, metadata);

  return {
    txBuilder,
    poolId: poolTokenName,
    lpTokenPolicy,
    stakingValidator,
  };
}

export type CreatePoolResult = Awaited<ReturnType<typeof createPool>>;
