import {
  Assets,
  Data,
  Emulator,
  fromHex,
  generatePrivateKey,
  toHex,
  toUnit,
  Translucent,
  Tx,
  UTxO,
} from "translucent-cardano";
import { promises as fs } from "fs";

import { C } from "lucid-cardano";
import {
  OracleValidatorSpend,
  PlaceholderNftPlaceholderNft,
} from "./../../plutus.ts";
import { TokenData, ValidityRange } from "./../../src/types.ts";
import { nameFromUTxO, ValidatorRefs } from "./../../src/util.ts";
import { TransactionOutputJSON } from "@dcspark/cardano-multiplatform-lib-nodejs";

export const LENFI_POLICY_ID =
  "8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f69587";
export const LENFI_TOKEN_NAME = stringToHex("LENFI");
export const LENFI_UNIT = toUnit(LENFI_POLICY_ID, LENFI_TOKEN_NAME);

export const MIN_POLICY_ID =
  "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6";
export const MIN_TOKEN_NAME = stringToHex("MIN");
export const MIN_UNIT = toUnit(MIN_POLICY_ID, MIN_TOKEN_NAME);

export async function generateAccount(assets: Assets) {
  const privateKey = generatePrivateKey();
  return {
    privateKey,
    address: await (await Translucent.new(undefined, "Custom"))
      .selectWalletFromPrivateKey(privateKey)
      .wallet.address(),
    assets,
  };
}
export type GeneratedAccount = Awaited<ReturnType<typeof generateAccount>>;

export function stringToHex(str: string): string {
  let res = "";
  for (let i = 0; i < str.length; i++) {
    res += str.charCodeAt(i).toString(16);
  }
  return res;
}

export interface AssetClass {
  policy: string;
  name: string;
}

// Oracle for arbitrary tokens
export async function createMockOracle(
  lucid: Translucent,
  tx: Tx,
  producedOutputIdx: bigint,
  { validators, deployedValidators }: ValidatorRefs
) {
  const utxos = await lucid.utxosAt(await lucid.wallet.address());
  const utxoToConsume = utxos[utxos.length - 1];
  const lenfiNftName = nameFromUTxO(utxoToConsume);

  // Using pregenerated key for testing purposes.
  const privateKeytext = await fs.readFile(`./tests/pool/oracle/keys.sk`);
  const privateKeytext2 = await fs.readFile(`./tests/pool/oracle/keys2.sk`);
  const privateKey = C.PrivateKey.from_bech32(privateKeytext.toString());
  const privateKey2 = C.PrivateKey.from_bech32(privateKeytext2.toString());

  const publicKey = toHex(privateKey.to_public().as_bytes());
  const publicKey2 = toHex(privateKey2.to_public().as_bytes());

  const oracleNft = {
    policyId: validators.oracleNftPolicyId,
    assetName: lenfiNftName,
  };

  const oracleValidator = new OracleValidatorSpend(
    [publicKey], //, publicKey2, publicKey2],
    1n,
    oracleNft,
    validators.govNft
  );

  const contractAddress = lucid.utils.validatorToAddress(oracleValidator);

  const nftRedeemer: PlaceholderNftPlaceholderNft["r"] = {
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

  const rewardsAddress = lucid.utils.validatorToRewardAddress(oracleValidator);

  const txBuilder = tx
    .collectFrom([utxoToConsume])
    .payToContract(
      contractAddress,
      {
        inline: "d87980",
      },
      {
        lovelace: 2000000n,
        [toUnit(validators.oracleNftPolicyId, lenfiNftName)]: 1n,
      }
    )
    .readFrom([deployedValidators.oracleNftPolicy])
    .registerStake(rewardsAddress)
    .mintAssets(
      {
        [toUnit(validators.oracleNftPolicyId, lenfiNftName)]: BigInt(1),
      },
      Data.to(nftRedeemer, PlaceholderNftPlaceholderNft.r)
    );

  return {
    txBuilder,
    oracleNft: toUnit(validators.oracleNftPolicyId, lenfiNftName),
    oracleValidator,
  };
}

export type tokenQueryFunc = (tokenId: string) => Promise<TokenData>;

export function quickSubmitBuilder(emulator: Emulator) {
  return async function ({ txBuilder }: { txBuilder: Tx }) {
    const completedTx = await txBuilder.complete();
    const signedTx = await completedTx.sign().complete();
    const txHash = signedTx.submit();
    emulator.awaitBlock(1);

    return txHash;
  };
}

export function quickSubmitBuilderLog(emulator: Emulator) {
  return async function ({ txBuilder }: { txBuilder: Tx }) {
    console.log(
      "inputs:",
      C.Transaction.from_bytes(fromHex(await txBuilder.toString()))
        .body()
        .inputs()
        .to_json()
    );

    const outputs = C.Transaction.from_bytes(
      fromHex(await txBuilder.toString())
    )
      .body()
      .outputs()
      .to_json();

    const outputss = extractAddressAndValue(JSON.parse(outputs));

    for (const output of outputss) {
      console.log(output.address.address, output.coins, output.assets);
    }

    const completedTx = await txBuilder.complete();
    const signedTx = await completedTx.sign().complete();
    const txHash = signedTx.submit();
    emulator.awaitBlock(1);
    return txHash;
  };
}

function extractAddressAndValue(utxos: TransactionOutputJSON[]): any[] {
  return utxos.map((utxo) => ({
    address: utxo,
    coins: utxo.amount.coin,
    assets: utxo.amount.multiasset
      ? Object.entries(utxo.amount.multiasset).map(([policyId, assets]) => ({
          policyId,
          assets: utxo.amount.multiasset
            ? Object.entries(assets).map(([assetName, amount]) => ({
                assetName,
                amount: BigInt(amount),
              }))
            : [],
        }))
      : [],
  }));
}
type AssetBalance = {
  lovelace: bigint;
  [asset: string]: bigint;
};

function sumAssets(balances: UTxO[]): AssetBalance {
  const total: AssetBalance = { lovelace: 0n };

  for (const balance of balances) {
    for (const [asset, amount] of Object.entries(balance.assets)) {
      total[asset] = (total[asset] || 0n) + BigInt(amount);
    }
  }

  return total;
}

export function isNewBalanceGreater(
  oldBalances: UTxO[],
  newBalances: UTxO[]
): boolean {
  const oldTotal = sumAssets(oldBalances);
  const newTotal = sumAssets(newBalances);

  for (const asset in newTotal) {
    if (!oldTotal[asset] || newTotal[asset] > oldTotal[asset]) {
      return true;
    }
  }

  return false;
}
