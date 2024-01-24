import { Data, toUnit, Translucent, Tx, Validator } from "translucent-cardano";
import { getPoolArtifacts, ValidatorRefs } from "./../util.ts";
import {
  LiquidityTokenLiquidityToken,
  PlaceholderNftPlaceholderNft,
  PoolMint,
  PoolSpend,
} from "./../../plutus.ts";
interface DeletePoolArgs {
  poolTokenName: string;
}

export async function deletePool(
  lucid: Translucent,
  tx: Tx,
  { poolTokenName }: DeletePoolArgs,
  { validators, deployedValidators }: ValidatorRefs,
  lpTokenPolicy: Validator
) {
  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );
  const poolDatumMapped = poolArtifacts.poolDatumMapped;

  const lpTokensToWithdraw = Number(poolDatumMapped.totalLpTokens);

  // Withdraw redeemer
  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: "Destroy",
      configRef: {
        transactionId: { hash: poolArtifacts.configUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.configUTxO.outputIndex),
      },
      order: null,
    },
  };

  const lpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
    DestroyPool: {
      poolOref: {
        transactionId: { hash: poolArtifacts.poolUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
      },
    },
  };

  const poolNftRedeemer: PoolMint["redeemer"] = {
    BurnPoolNFT: [poolTokenName],
  };

  const delegatorNftRedeemer: PlaceholderNftPlaceholderNft["r"] = {
    action: {
      BurnNFT: [poolDatumMapped.params.poolConfigAssetname],
    },
    inner: undefined,
  };

  const metadata = {
    msg: ["Lenfi: removed pool"],
  };

  const [paramsUtxo] = await lucid.utxosByOutRef([
    {
      txHash: poolArtifacts.configUTxO.txHash,
      outputIndex: poolArtifacts.configUTxO.outputIndex,
    },
  ]);

  const referenceScriptUtxo = [
    deployedValidators["poolValidator"],
    deployedValidators["delegatorNftPolicy"],
    deployedValidators["leftoverValidator"],
    paramsUtxo,
  ];

  const txBuilder = tx
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .readFrom(referenceScriptUtxo)
    .attachMintingPolicy(lpTokenPolicy)
    .mintAssets(
      {
        [toUnit(
          poolDatumMapped.params.lpToken.policyId,
          poolDatumMapped.params.lpToken.assetName
        )]: BigInt(lpTokensToWithdraw) * -1n,
      },
      Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
    )
    .mintAssets(
      {
        [toUnit(validators.poolScriptHash, poolTokenName)]: BigInt(-1),
      },
      Data.to(poolNftRedeemer, PoolMint.redeemer)
    )
    .mintAssets(
      {
        [toUnit(
          validators.delegatorNftPolicyId,
          poolDatumMapped.params.poolConfigAssetname
        )]: BigInt(-1),
      },
      Data.to(delegatorNftRedeemer, PlaceholderNftPlaceholderNft.r)
    )
    .attachMetadata(674, metadata);

  return { txBuilder };
}
