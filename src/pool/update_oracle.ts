import { OracleValidatorSpend } from "./../../plutus";
import {
  Data,
  toUnit,
  Validator,
  Translucent,
  Tx,
  toHex,
  C,
} from "translucent-cardano";
import { ValidatorRefs } from "../util.ts";
import { promises as fs } from "fs";
import { UTxO } from "translucent-cardano";

interface UpdateConfigArgs {
  poolTokenName: string;
  poolStakeValidator: Validator;
}

export async function updateOracle(
  lucid: Translucent,
  tx: Tx,
  oracleTokenUnit: string,
  oracleValidator: Validator,
  { poolTokenName }: UpdateConfigArgs,
  { validators, deployedValidators }: ValidatorRefs
) {
  const governanceNFT = toUnit(
    validators.govNft.policyId,
    validators.govNft.assetName
  );

  const governanceNftUtxo: UTxO =
    await lucid.provider.getUtxoByUnit(governanceNFT);

  const oracleAsset: { policyId: string; assetName: string } = {
    policyId: oracleTokenUnit.substring(0, 56),
    assetName: oracleTokenUnit.substring(56),
  };

  // Using pregenerated key for testing purposes.
  const privateKeytext = await fs.readFile(`./tests/pool/oracle/keys.sk`);
  const privateKeytext2 = await fs.readFile(`./tests/pool/oracle/keys2.sk`);
  const privateKey = C.PrivateKey.from_bech32(privateKeytext.toString());
  const privateKey2 = C.PrivateKey.from_bech32(privateKeytext2.toString());

  const publicKey = toHex(privateKey.to_public().as_bytes());
  const publicKey2 = toHex(privateKey2.to_public().as_bytes());

  const oracleValidatorNew = new OracleValidatorSpend(
    [publicKey, publicKey2, publicKey2],
    1n,
    validators.govNft,
    oracleAsset
  );

  // Update loan oracle
  const loanOracleUtxo: UTxO =
    await lucid.provider.getUtxoByUnit(oracleTokenUnit);

  if (!loanOracleUtxo || !loanOracleUtxo.datum || !governanceNftUtxo) {
    throw new Error("Oracle token not found");
  }

  const oracleRedemer: OracleValidatorSpend["_r"] = {
    wrapper: Data.void(),
  };

  const contractAddress = lucid.utils.validatorToAddress(oracleValidatorNew);
  const rewardsAddress =
    lucid.utils.validatorToRewardAddress(oracleValidatorNew);

  tx.collectFrom(
    [loanOracleUtxo],
    Data.to(oracleRedemer, OracleValidatorSpend._r)
  )
    .attachSpendingValidator(oracleValidator)
    .registerStake(rewardsAddress)
    .payToContract(
      contractAddress,
      {
        inline: "d87980",
      },
      {
        lovelace: 2000000n,
        [oracleTokenUnit]: 1n,
      }
    )
    .readFrom([governanceNftUtxo])
    .addSigner(governanceNftUtxo.address);

  return { txBuilder: tx, validator: oracleValidatorNew };
}
