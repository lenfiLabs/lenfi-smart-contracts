import { Script, toScriptRef, Translucent, Tx, UTxO } from "translucent-cardano"
import { collectValidators, DeployedValidators, Validators } from "./util.ts"
import { defaultConfig } from "./constants.ts"
import { OutputReference } from "./types.ts"

function deployContract(
  lucid: Translucent,
  validator: Script,
): Tx {
  const validatorAddress = lucid.utils.validatorToAddress(
    validator,
  )

  // const Datum = () => Data.void();

  const tx = lucid
    .newTx()
    .payToContract(
      validatorAddress,
      {
        inline: "d87980",
        scriptRef: validator,
      },
      {},
    )
  return tx
}

type KeyValueTuple<T> = [string, T]
// Name, UTxO
type DeployedValidator = [string, UTxO]

async function replaceValidators(
  newValidator: DeployedValidator,
) {
  // Step 2: Read the JSON file
  const fileData = await fs.readFile("../../src/deployedValidators.json")
  const deployedValidators: DeployedValidators = JSON.parse(fileData)

  // Step 3: Replace the JSON data with the new value
  // Find the index of the validator to replace

  const [name, utxo] = newValidator

  deployedValidators[name] = utxo

  // Save the replaced data back to the file
  await Deno.writeTextFile(
    "../../src/deployedValidators.json",
    JSON.stringify(deployedValidators, null, 2),
  )
  // await fs.promises.writeFile(jsonFilePath, JSON.stringify(deployedValidators, null, 2));
}

async function processElement(
  lucid: Translucent,
  key: string,
  validator: Script,
  writeToFile: boolean,
): Promise<DeployedValidator> {
  // const validator = await buildValidator(nftData.validator);
  const validatorTx = deployContract(lucid, validator)
  // const validatorTx = "acda77eae525f83ae207ea0ce41df028043177df1f076e767f5ed52a2d379312";

  const completedTx = await validatorTx.complete()

  const finalOutputs = completedTx.txComplete.to_js_value().body.outputs

  const newTxOutputIdx = finalOutputs.findIndex((o: any) => {
    if (!o.script_ref) return false
    return o.script_ref?.PlutusScriptV2 ===
      toScriptRef(validator).to_js_value().PlutusScriptV2
  })

  const newTxOutput = finalOutputs[newTxOutputIdx]

  const signedTx = await completedTx
    .sign()
    .complete()

  const txHash = await signedTx.submit()

  const newUtxo: UTxO = {
    address: newTxOutput.address,
    txHash,
    outputIndex: newTxOutputIdx,
    scriptRef: validator,
    assets: {
      lovelace: BigInt(newTxOutput.amount.coin),
    },
    datum: "d87980",
  }

  const newValidator: DeployedValidator = [key, newUtxo]

  if (writeToFile) {
    await replaceValidators(newValidator)
      .catch((err) => {
        throw new Error(err)
      })
  }
  await lucid.awaitTx(txHash)
  //await sleep(40000) // Sleep for some time
  return newValidator
}

type PromiseFunction<T> = () => Promise<T>

async function executePromiseFunctions<T>(
  promiseArray: PromiseFunction<KeyValueTuple<T>>[],
): Promise<Record<string, T>> {
  const resultsObject: Record<string, T> = {}

  for (const promiseFn of promiseArray) {
    const result = await promiseFn()
    resultsObject[result[0]] = result[1]
  }

  return resultsObject
}

interface DeployOptions {
  writeToFile?: boolean
  validators?: Validators
}

export async function deployValidators(
  lucid: Translucent,
  {
    writeToFile = true,
    validators,
  }: DeployOptions = {},
): Promise<DeployedValidators> {
  // Deploy all related contracts
  if (!validators) {
    const initialOutputRef: OutputReference = {
      transactionId: { hash: "" },
      outputIndex: 0n,
    }

    validators = collectValidators(
      lucid,
      defaultConfig,
      "",
      "",
    )
  }

  let res: DeployedValidators = {}

  const deploymentsChain = [
    () =>
      processElement(
        lucid,
        "collateralValidator",
        validators!.collateralValidator,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "lpTokenPolicy",
        validators!.lpTokenPolicy,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "poolValidator",
        validators!.poolValidator,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "delegatorNftPolicy",
        validators!.delegatorNftPolicy,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "poolConfigNftPolicy",
        validators!.poolConfigPolicy,
        writeToFile,
      ),
      () =>
      processElement(
        lucid,
        "poolConfigValidator",
        validators!.poolConfigValidator,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "oracleNftPolicy",
        validators!.oracleNftPolicy,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "leftoverValidatorPkh",
        validators!.leftoverValidator,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "mergeScript",
        validators!.mergeScript,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "leftoverValidator",
        validators!.leftoverValidator,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "oracleNftPolicy",
        validators!.oracleNftPolicy,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "orderContractBorrow",
        validators!.orderContractBorrow,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "orderContractDeposit",
        validators!.orderContractDeposit,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "orderContractRepay",
        validators!.orderContractRepay,
        writeToFile,
      ),
    () =>
      processElement(
        lucid,
        "orderContractWithdraw",
        validators!.orderContractWithdraw,
        writeToFile,
      ),
  ]

  await executePromiseFunctions(deploymentsChain)
    .then((deployments) => {
      res = deployments
    })
    .catch((err) => {
      throw new Error(err)
    })

  return res
}
