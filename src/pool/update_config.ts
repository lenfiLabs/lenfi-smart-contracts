import { Data, toUnit, Validator, Translucent, Tx } from "translucent-cardano";
import {
  generateReceiverAddress,
  getPoolArtifacts,
  ValidatorRefs,
} from "./../util.ts";

import { PoolConfigSpend } from "./../../plutus.ts";
import { UTxO } from "translucent-cardano";

interface UpdateConfigArgs {
  poolTokenName: string;
  poolStakeValidator: Validator;
}

export async function updateConfig(
  lucid: Translucent,
  tx: Tx,
  { poolTokenName }: UpdateConfigArgs,
  { validators, deployedValidators }: ValidatorRefs
) {
  const governanceNFT = toUnit(
    validators.govNft.policyId,
    validators.govNft.assetName
  );

  const governanceNftUtxo: UTxO =
    await lucid.provider.getUtxoByUnit(governanceNFT);

  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );

  const poolConfigTn = poolArtifacts.poolDatumMapped.params.poolConfigAssetname
  const poolConfigTokenUtxo: UTxO = await lucid.provider.getUtxoByUnit(
    toUnit(validators.poolConfigPolicyId, poolConfigTn)
  );

  if (
    !poolConfigTokenUtxo ||
    !poolConfigTokenUtxo.datum ||
    !governanceNftUtxo
  ) {
    throw new Error("Pool config token not found");
  }

  let poolConfigDatum: PoolConfigSpend["datum"] = Data.from<
    PoolConfigSpend["datum"]
  >(poolConfigTokenUtxo.datum, PoolConfigSpend["datum"]);

  // Update pool config these will helpto manage in case of bad actors.
  poolConfigDatum.poolFee = 8900000n; // Fixed fee paid to the pool whenever interacting with it
  poolConfigDatum.minFee = 9000000n; // Min Fee paid to the pool. for example when withdrawing StakePool rewards. Cannot be less than poolFee.
  poolConfigDatum.mergeActionFee = 24000000n; // Fee paid as addition to validator address. Will be taken by whoever executes the merge action. Cannot be less than poolFee.
  poolConfigDatum.minTransition = 200n; // Minimum amount of tokens that can be transitioned in the pool (withdrawed/deposited)
  poolConfigDatum.minLoan = 2000000n; // Min loan amount that can be made.

  // Loan fee details (paid to outside address of fee collector)
  poolConfigDatum.loanFeeDetails.tier_1Fee = 100000n; // Tier 1 fee (calculated as % of interest). 100000 = 10%
  poolConfigDatum.loanFeeDetails.tier_2Fee = 450000n; // Tier 2 fee
  poolConfigDatum.loanFeeDetails.tier_3Fee = 600000n; // Tier 3 fee
  poolConfigDatum.loanFeeDetails.liquidationFee = 250000n; // Fee deducted from liquidated loan collateral for the liquidator

  // Update how interest is calculated
  poolConfigDatum.interestParams.baseInterestRate = 500000n;
  poolConfigDatum.interestParams.optimalUtilization = 600000n;
  poolConfigDatum.interestParams.rslope1 = 75000n;
  poolConfigDatum.interestParams.rslope2 = 300000n;

  const poolConfigRedeemer: PoolConfigSpend["redeemer"] = {
    wrapper: {
      poolConfigOutputIndex: 0n,
      feeCollectorOutputIndex: 1n,
    },
  };

  const feeReceiverAddress = generateReceiverAddress(
    lucid,
    poolConfigDatum.loanFeeDetails.platformFeeCollectorAddress
  );

  const configNft = toUnit(validators.poolConfigPolicyId, poolConfigTn);

  tx.readFrom([governanceNftUtxo])
    .collectFrom(
      [poolConfigTokenUtxo],
      Data.to(poolConfigRedeemer, PoolConfigSpend.redeemer)
    )
    .readFrom([deployedValidators.poolConfigValidator])
    .payToAddressWithData(
      poolConfigTokenUtxo.address, // Pool config
      { inline: Data.to(poolConfigDatum, PoolConfigSpend.datum) },
      {
        [configNft]: 1n,
      }
    )
    .payToAddress(feeReceiverAddress, { ["lovelace"]: 2000000n })
    .addSigner(governanceNftUtxo.address);

  return { txBuilder: tx };
}
