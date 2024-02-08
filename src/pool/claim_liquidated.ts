import { Data, toUnit, Translucent, Tx } from "translucent-cardano";

import { DeployedValidators, getValidityRange } from "./../util.ts";

import { CollateralMint, LeftoversLeftovers } from "./../../plutus.ts";
import { ValidityRange } from "../types.ts";

export async function claimLiquidated(
  lucid: Translucent,
  tx: Tx,
  now: number,
  liquidationTxHash: string,
  liquidationTxOutouput: number,
  deployedValidators: DeployedValidators
) {
  const validityRange: ValidityRange = getValidityRange(lucid, now);
  const leftOverRedeemer = Data.void();
  const utxoToSpend = await lucid.utxosByOutRef([
    {
      txHash: liquidationTxHash,
      outputIndex: liquidationTxOutouput,
    },
  ]);

  const liquidationDatum: LeftoversLeftovers["datum"] = await lucid.datumOf(
    utxoToSpend[0],
    LeftoversLeftovers.datum
  );

  let borrowerTokenRedeemer: CollateralMint["redeemer"] = {
    mints: [],
    burns: [{ tokenName: liquidationDatum.assetName }],
    // burns: [{ tokenName: "ff" }],
  };

  const txBuilder = tx
    .collectFrom(utxoToSpend, leftOverRedeemer)
    .mintAssets(
      {
        [toUnit(liquidationDatum.policyId, liquidationDatum.assetName)]:
          BigInt(-1),
      },
      Data.to(borrowerTokenRedeemer, CollateralMint.redeemer)
    )
    .readFrom([deployedValidators.collateralValidator])
    .readFrom([deployedValidators.leftoverValidator])
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo);

  return {
    txBuilder,
  };
}
