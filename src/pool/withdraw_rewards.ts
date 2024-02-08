import {
  Data,
  stakeCredentialOf,
  toUnit,
  Translucent,
  Tx,
  Validator,
  UTxO,
} from "translucent-cardano";

import {
  assetGainAdaSale,
  getPoolArtifacts,
  getValidityRange,
  toUnitOrLovelace,
  ValidatorRefs,
} from "./../util.ts";

import {
  OracleValidatorWithdrawValidate,
  PoolSpend,
  PoolStakePoolStake,
} from "./../../plutus.ts";
import { ValidityRange } from "../types.ts";

interface WithdrawPoolRewardsArgs {
  poolTokenName: string;
  poolStakeValidator: Validator;
  loanOracleValidator: Validator;
  loanOracleDetails?: OracleValidatorWithdrawValidate["redeemer"];
  now: number;
}

export async function withdrawPoolRewards(
  lucid: Translucent,
  tx: Tx,
  {
    poolTokenName,
    poolStakeValidator,
    loanOracleValidator,
    loanOracleDetails,
    now,
  }: WithdrawPoolRewardsArgs,
  { validators, deployedValidators }: ValidatorRefs
) {
  const validityRange: ValidityRange = getValidityRange(lucid, now);
  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );
  const poolDatumMapped = poolArtifacts.poolDatumMapped;

  const rewardsAddress =
    lucid.utils.validatorToRewardAddress(poolStakeValidator);

  const poolContractAddress = lucid.utils.validatorToAddress(
    validators.poolValidator,
    stakeCredentialOf(rewardsAddress)
  );

  const stakeAddressDetails =
    await lucid.provider.getDelegation(rewardsAddress);

  const rewardsAmountInADA = stakeAddressDetails
    ? BigInt(stakeAddressDetails.rewards)
    : 0n;


  const rewardAmountAdjusted = rewardsAmountInADA - 2000000n;
  let rewardsAmount: bigint = rewardAmountAdjusted;
  let rewardsRedeemer: "ExactWithdrawal" | "SwapWithdrawal" = "ExactWithdrawal";

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
    rewardsRedeemer = "SwapWithdrawal";
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

    rewardsAmount = assetGainAdaSale(
      loanOracleDetails,
      rewardAmountAdjusted,
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName
    );
  }

  poolDatumMapped.balance = poolDatumMapped.balance + rewardsAmount;

  // Withdraw redeemer
  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            PayFee: {
              fee: rewardsAmount, // Will not work with non-ADA
              continuingOutput: 0n,
            },
          },
        ],
      },
      order: null,
      configRef: {
        transactionId: { hash: poolArtifacts.configUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.configUTxO.outputIndex),
      },
    },
  };

  const poolWithdrawRedeemer: PoolStakePoolStake["redeemer"] = {
    Withdraw: [
      {
        action: rewardsRedeemer,
        poolOref: {
          transactionId: { hash: poolArtifacts.poolUTxO.txHash },
          outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
        },
      },
    ],
  };

  const metadata = {
    msg: ["Lenfi: Withdrew delegation rewards"],
  };

  const poolOwnerNft = toUnit(
    validators.delegatorNftPolicyId,
    poolDatumMapped.params.poolConfigAssetname
  );
  const poolOwnerUtxo = await lucid.provider.getUtxoByUnit(poolOwnerNft);

  tx.readFrom([deployedValidators.poolValidator])
    .readFrom([poolArtifacts.configUTxO])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .withdraw(
      rewardsAddress,
      rewardsAmountInADA,
      Data.to(poolWithdrawRedeemer, PoolStakePoolStake.redeemer)
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
    .attachWithdrawalValidator(poolStakeValidator)
    .readFrom([poolOwnerUtxo])
    .attachMetadata(674, metadata)
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo);

  if (oracleValidators.length > 0) {
    tx.readFrom(oracleUtxos)
      .withdraw(
        oracleValidators[0].rewardAddress,
        0n,
        Data.to(
          oracleValidators[0].redeemer,
          OracleValidatorWithdrawValidate.redeemer
        )
      )
      .attachWithdrawalValidator(oracleValidators[0].validator);
  }

  return { txBuilder: tx };
}
