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
  getOutputReference,
  getPoolArtifacts,
  PoolArtifacts,
  toUnitOrLovelace,
  ValidatorRefs,
} from "./../util.ts";
import { LpTokenCalculation, OutputReference } from "./../types.ts";
import { LiquidityTokenLiquidityToken, PoolSpend } from "./../../plutus.ts";

interface DepositArgs {
  balanceToDeposit: bigint;
  poolTokenName: string;
  // lpTokenPolicy: Validator
  poolStakeValidator: Validator;
}

interface DepositInnerArgs extends DepositArgs {
  poolArtifacts: PoolArtifacts;
}

export function makeDeposit(
  lucid: Translucent,
  tx: Tx,
  continuingOutputIdx: bigint,
  {
    balanceToDeposit,
    poolTokenName,
    poolStakeValidator,
    poolArtifacts,
  }: DepositInnerArgs,
  { validators, deployedValidators }: ValidatorRefs,
  order: OutputReference | null = null,
  lpTokensDelta: bigint
) {
  const rewardsAddress =
    lucid.utils.validatorToRewardAddress(poolStakeValidator);
  const poolAddress = lucid.utils.validatorToAddress(
    validators.poolValidator,
    stakeCredentialOf(rewardsAddress)
  );

  const poolDatumMapped = poolArtifacts.poolDatumMapped;
  const poolConfigDatum = poolArtifacts.poolConfigDatum;

  const lpTokenPolicy = new LiquidityTokenLiquidityToken(
    validators.poolScriptHash,
    poolTokenName
  );

  if (balanceToDeposit <= poolConfigDatum.minTransition) {
    throw "Deposit amount is too small";
  }

  const lpTokensToDepositDetails: LpTokenCalculation = calculateLpTokens(
    poolDatumMapped.balance,
    poolDatumMapped.lentOut,
    balanceToDeposit,
    poolDatumMapped.totalLpTokens
  );

  const lpTokensToDeposit =
    lpTokensToDepositDetails.lpTokenMintAmount + lpTokensDelta;
  if (lpTokensToDepositDetails.lpTokenMintAmount > balanceToDeposit) {
    throw "User wants more LPs than allowed";
  }

  poolDatumMapped.balance =
    poolDatumMapped.balance +
    lpTokensToDepositDetails.depositAmount +
    poolConfigDatum.poolFee;

  poolDatumMapped.totalLpTokens =
    poolDatumMapped.totalLpTokens + lpTokensToDeposit;

  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            LpAdjust: {
              valueDelta: lpTokensToDepositDetails.depositAmount,
              continuingOutput: continuingOutputIdx,
            },
          },
        ],
      },
      configRef: getOutputReference(poolArtifacts.configUTxO),
      order,
    },
  };

  const lpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
    TransitionPool: {
      poolOref: getOutputReference(poolArtifacts.poolUTxO),
      continuingOutput: continuingOutputIdx,
    },
  };

  const metadata = {
    msg: ["Lenfi: Supplied to pool"],
  };

  const lpTokenPolicyId = lucid.utils.validatorToScriptHash(lpTokenPolicy);
  const txBuilder = tx
    .readFrom([deployedValidators.poolValidator])
    .payToAddressWithData(
      poolAddress,
      { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.loanCs.policyId,
          poolDatumMapped.params.loanCs.assetName
        )]: poolDatumMapped.balance,
        [toUnit(validators.poolScriptHash, poolTokenName)]: BigInt(1),
      }
    )
    .readFrom([poolArtifacts.configUTxO])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .attachMintingPolicy(lpTokenPolicy)
    .mintAssets(
      {
        [toUnit(lpTokenPolicyId, poolTokenName)]: BigInt(lpTokensToDeposit),
      },
      Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
    )
    .attachMetadata(674, metadata);

  return {
    txBuilder,
  };
}

export async function depositIntoPool(
  lucid: Translucent,
  tx: Tx,
  continuingOutputIdx: bigint,
  { balanceToDeposit, poolTokenName, poolStakeValidator }: DepositArgs,
  { validators, deployedValidators }: ValidatorRefs,
  lpTokenDelta = 0n
) {
  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );

  return makeDeposit(
    lucid,
    tx,
    continuingOutputIdx,
    {
      poolTokenName,
      balanceToDeposit,
      poolStakeValidator,
      poolArtifacts,
    },
    {
      validators,
      deployedValidators,
    },
    null,
    lpTokenDelta
  );
}
