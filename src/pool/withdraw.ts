import {
  Data,
  stakeCredentialOf,
  toUnit,
  Translucent,
  Tx,
  Validator,
} from "translucent-cardano";

import {
  calculateLpTokens,
  getPoolArtifacts,
  PoolArtifacts,
  toUnitOrLovelace,
  ValidatorRefs,
} from "./../util.ts";

import { LpTokenCalculation, OutputReference } from "./../types.ts";

import { LiquidityTokenLiquidityToken, PoolSpend } from "./../../plutus.ts";

interface WithdrawArgs {
  balanceToWithdraw: bigint;
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
    balanceToWithdraw,
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

  if (balanceToWithdraw <= poolConfigDatum.minTransition) {
    throw "Withdraw amount is too small";
  }

  // Calculate amount of LP tokens to be minted
  const lpTokensToDepositDetails: LpTokenCalculation = calculateLpTokens(
    poolDatumMapped.balance,
    poolDatumMapped.lentOut,
    balanceToWithdraw,
    poolDatumMapped.totalLpTokens
  );

  const depositAmount = lpTokensToDepositDetails.depositAmount + withdrawDelta;

  const lpTokensToWithdraw = BigInt(lpTokensToDepositDetails.lpTokenMintAmount);

  poolDatumMapped.balance =
    poolDatumMapped.balance - depositAmount + poolConfigDatum.poolFee;

  poolDatumMapped.totalLpTokens =
    poolDatumMapped.totalLpTokens - lpTokensToWithdraw;

  // Withdraw redeemer

  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            LpAdjust: {
              valueDelta: depositAmount * -1n,
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
        )]: lpTokensToWithdraw * -1n,
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
  { poolTokenName, balanceToWithdraw, poolStakeValidator }: WithdrawArgs,
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
      balanceToWithdraw,
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
