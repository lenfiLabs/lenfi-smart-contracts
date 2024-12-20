import {
  Data,
  stakeCredentialOf,
  toUnit,
  Translucent,
  Tx,
  Validator,
} from "translucent-cardano";

import {
  calculateLpsToBurn,
  getPoolArtifacts,
  PoolArtifacts,
  toUnitOrLovelace,
  ValidatorRefs,
} from "./../util.ts";

import { OutputReference } from "./../types.ts";

import { LiquidityTokenLiquidityToken, PoolSpend } from "./../../plutus.ts";

interface WithdrawArgs {
  amountToWithdraw: bigint;
  poolTokenName: string;
  poolStakeValidator: Validator;
}

interface WithdrawInnerArgs extends WithdrawArgs {
  poolArtifacts: PoolArtifacts;
}

export function makeWithdrawal(
  lucid: Translucent,
  tx: Tx,
  now: number,
  continuingOutputIdx: bigint,
  {
    poolTokenName,
    amountToWithdraw,
    poolStakeValidator,
    poolArtifacts,
  }: WithdrawInnerArgs,
  { validators, deployedValidators }: ValidatorRefs,
  order: OutputReference | null = null,
  withdrawDelta: bigint
) {
  const rewardsAddress =
    lucid.utils.validatorToRewardAddress(poolStakeValidator);
  const poolAddress = lucid.utils.validatorToAddress(
    validators.poolValidator,
    stakeCredentialOf(rewardsAddress)
  );
  const lpTokenPolicy = new LiquidityTokenLiquidityToken(
    validators.poolScriptHash,
    poolTokenName
  );

  const poolDatumMapped = poolArtifacts.poolDatumMapped;
  const poolConfigDatum = poolArtifacts.poolConfigDatum;

  let valueDelta = amountToWithdraw;

  if (Math.abs(Number(valueDelta)) <= poolConfigDatum.minTransition) {
    throw "Withdraw amount is too small";
  }

  // Calculate amount of LP tokens to be minted
  let lpsToBurn = calculateLpsToBurn(
    poolDatumMapped.balance,
    poolDatumMapped.lentOut,
    valueDelta,
    poolDatumMapped.totalLpTokens
  );

  valueDelta += withdrawDelta;

  poolDatumMapped.balance =
    poolDatumMapped.balance - valueDelta + poolConfigDatum.poolFee;
  poolDatumMapped.totalLpTokens =
    poolDatumMapped.totalLpTokens - BigInt(lpsToBurn);

  // Withdraw redeemer

  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            LpAdjust: {
              valueDelta: valueDelta * -1n,
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

  const lpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
    TransitionPool: {
      poolOref: {
        transactionId: { hash: poolArtifacts.poolUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
      },
      continuingOutput: continuingOutputIdx,
    },
  };

  const metadata = {
    msg: ["Lenfi: Withdrew supply"],
  };

  let valueToRepay = {
    [toUnitOrLovelace(
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName
    )]: poolDatumMapped.balance,
    [toUnit(validators.poolScriptHash, poolTokenName)]: 1n,
  };
  // Withdrawing all.
  if (poolDatumMapped.balance == 0n) {
    valueToRepay = {
      [toUnit(validators.poolScriptHash, poolTokenName)]: 1n,
    };
  }

  const txBuilder = tx
    .readFrom([deployedValidators.poolValidator])
    .readFrom([poolArtifacts.configUTxO])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .payToContract(
      poolAddress,
      {
        inline: Data.to(poolDatumMapped, PoolSpend.datum),
      },
      valueToRepay
    )
    .attachMintingPolicy(lpTokenPolicy)
    .mintAssets(
      {
        [toUnit(
          poolDatumMapped.params.lpToken.policyId,
          poolDatumMapped.params.lpToken.assetName
        )]: BigInt(lpsToBurn) * -1n,
      },
      Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
    )
    .attachMetadata(674, metadata);
  return {
    txBuilder,
  };
}

export async function withdrawFromPool(
  lucid: Translucent,
  tx: Tx,
  continuingOutputIdx: bigint,
  now: number,
  { poolTokenName, amountToWithdraw, poolStakeValidator }: WithdrawArgs,
  { validators, deployedValidators }: ValidatorRefs,
  withdrawDelta = 0n
) {
  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );

  return makeWithdrawal(
    lucid,
    tx,
    now,
    continuingOutputIdx,
    {
      poolTokenName,
      amountToWithdraw,
      poolStakeValidator,
      poolArtifacts,
    },
    {
      validators,
      deployedValidators,
    },
    null,
    withdrawDelta
  );
}
