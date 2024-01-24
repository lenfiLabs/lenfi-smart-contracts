import {
  Data,
  Translucent,
  stakeCredentialOf,
  toUnit,
  Tx,
  UTxO,
  Validator,
} from "translucent-cardano"
import {
  getPoolArtifacts,
  getValidityRange,
  toUnitOrLovelace,
  ValidatorRefs,
} from "./../util.ts"
import { ValidityRange } from "./../types.ts"
import {
  DelayedMergeSpend,
  DelayedMergeWithdrawValidate,
  PoolSpend,
} from "./../../plutus.ts"

interface PoolMergeArgs {
  txHash: string
  poolTokenName: string
  outputIndex: bigint
  poolStakeValidator: Validator
  reduction: bigint
}
interface GroupedMerges {
  [poolTokenName: string]: PoolMergeArgs[]
}

export async function mergeToPool(
  lucid: Translucent,
  tx: Tx,
  now: number,
  mergeUtxos: PoolMergeArgs[],
  { validators, deployedValidators }: ValidatorRefs,
) {
  const validityRange: ValidityRange = getValidityRange(lucid, now)

  const mergesGroupedByPool: GroupedMerges = mergeUtxos.reduce(
    (acc: GroupedMerges, loan) => {
      const groupName = loan.poolTokenName
      if (!acc[groupName]) {
        acc[groupName] = []
      }
      acc[groupName].push(loan)
      return acc
    },
    {} as GroupedMerges,
  )

  for (const [poolTokenName, merges] of Object.entries(mergesGroupedByPool)) {
    const rewardsAddress = lucid.utils.validatorToRewardAddress(
      merges[0].poolStakeValidator,
    )
    const poolContractAddress = lucid.utils.validatorToAddress(
      validators.poolValidator,
      stakeCredentialOf(rewardsAddress),
    )

    const poolArtifacts = await getPoolArtifacts(
      poolTokenName,
      validators,
      lucid,
    )

    const poolDatumMapped = poolArtifacts.poolDatumMapped

    let amountToRepay = 0n
    let laonAmount = 0n
    // Parse every loan used in the pool
    for (const merge of merges) {
      const utxoToConsumeMerge: UTxO[] = await lucid.utxosByOutRef([
        {
          txHash: merge.txHash,
          outputIndex: Number(merge.outputIndex),
        },
      ])

      const mergeDatumMapped = await lucid.datumOf(
        utxoToConsumeMerge[0],
        DelayedMergeSpend._datum,
      )

      amountToRepay += mergeDatumMapped.repayAmount
      laonAmount += mergeDatumMapped.loanAmount

      // borrowerNftsToBurn.push({ tokenName: collateralDatumMapped.borrowerTn });
      const mergeContractRedeemer: DelayedMergeSpend["_r"] = {
        wrapper: Data.void(),
      }

       tx.collectFrom(
        utxoToConsumeMerge,
        Data.to(mergeContractRedeemer, DelayedMergeSpend._r),
      )
    }

    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: {
          Continuing: [
            {
              CloseLoan: {
                loanAmount: laonAmount,
                repayAmount: amountToRepay,
                continuingOutput: 0n,
              },
            },
          ],
        },
        configRef: {
          transactionId: { hash: poolArtifacts.configUTxO.txHash },
          outputIndex: BigInt(poolArtifacts.configUTxO.outputIndex),
        },
        order: null,
      },
    }

    poolDatumMapped.balance = poolDatumMapped.balance + amountToRepay + poolArtifacts.poolConfigDatum.poolFee;
    poolDatumMapped.lentOut = poolDatumMapped.lentOut - laonAmount

    tx
      .collectFrom(
        [poolArtifacts.poolUTxO],
        Data.to(poolRedeemer, PoolSpend.redeemer),
      )
      .payToContract(
        poolContractAddress,
        {
          inline: Data.to(poolDatumMapped, PoolSpend.datum),
        },
        {
          [
            toUnitOrLovelace(
              poolDatumMapped.params.loanCs.policyId,
              poolDatumMapped.params.loanCs.assetName,
            )
          ]: poolDatumMapped.balance,
          [toUnit(validators.poolScriptHash, poolTokenName)]: 1n,
        },
      )
      .readFrom([poolArtifacts.configUTxO])
      .withdraw(
        lucid.utils.validatorToRewardAddress(validators.mergeScript),
        0n,
        Data.to(
          poolTokenName,
          DelayedMergeWithdrawValidate.poolNftNameRedeemer,
        ),
      )
  }

  const metadata = {
    msg: ["Lenfi: merging to pool"],
  }

  const txBuilder = tx
    .readFrom([deployedValidators.poolValidator])
    .readFrom([deployedValidators.mergeScript])
    .attachMetadata(674, metadata)
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo)

  return { txBuilder }
}
