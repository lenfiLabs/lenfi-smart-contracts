import { Data, toUnit, Translucent, Tx } from "translucent-cardano";
import { nameFromUTxO } from "./../util.ts";

import { PlaceholderNftPlaceholderNft } from "./../../plutus.ts";

export async function createGovernanceNFT(lucid: Translucent, tx: Tx) {

  const utxos = await lucid.wallet.getUtxos();
  const utxoToConsume = utxos[utxos.length - 1];

  const producedNft = nameFromUTxO(utxoToConsume);

  const tempGovTokenPolicy = new PlaceholderNftPlaceholderNft(7n); // Making up the token. But it could be basically any NFT or even adahandle.
  const govNft = {
    policyId: lucid.utils.mintingPolicyToId(tempGovTokenPolicy),
    assetName: producedNft,
  };

  const governanceNFT = toUnit(govNft.policyId, govNft.assetName);

  const governanceNftRedeemer: PlaceholderNftPlaceholderNft["r"] = {
    action: {
      MintNFT: [
        {
          transactionId: {
            hash: utxoToConsume.txHash,
          },
          outputIndex: BigInt(utxoToConsume.outputIndex),
        },
        0n,
      ],
    },
    inner: undefined,
  };

  let metadata = {
    msg: ["Initiating Lenfi protocol"],
  };

  tx.collectFrom([utxoToConsume])
    .attachMetadata(674, metadata)
    .attachMintingPolicy(tempGovTokenPolicy)
    .mintAssets(
      { [governanceNFT]: 1n },
      Data.to(governanceNftRedeemer, PlaceholderNftPlaceholderNft.r)
    );

  return { txBuilder: tx, governanceNFTName: govNft.assetName };
}
