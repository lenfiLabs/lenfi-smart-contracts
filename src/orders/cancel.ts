import {
  Data,
  getAddressDetails,
  Translucent,
  Tx,
  UTxO,
  Validator,
} from "translucent-cardano"
import { getValidityRange, ValidatorRefs } from "./../../src/util.ts"
import { OrderContractDepositOrderContract } from "./../../plutus.ts"
import { ValidityRange } from "./../../src/types.ts"
import { ActionName } from "./../../src/batcher.ts"

interface BatcherCancelArgs {
  actionName: ActionName
  batcherUtxo: UTxO
}

export async function cancelOrder(lucid: Translucent, tx: Tx, now: number, {
  actionName,
  batcherUtxo,
}: BatcherCancelArgs, {
  validators,
}: ValidatorRefs) {
  const validityRange: ValidityRange = getValidityRange(lucid, now)

  const batcherRedeemer: OrderContractDepositOrderContract["redeemer"] =
    "Cancel"
  let validator: Validator

  if (actionName == "Deposit") {
    validator = validators.orderContractDeposit
  } else if (actionName == "Withdraw") {
    validator = validators.orderContractWithdraw
  } else if (actionName == "Repay") {
    validator = validators.orderContractRepay
  } else if (actionName == "Borrow") {
    validator = validators.orderContractBorrow
  } else {
    throw "Did not find such batcher action"
  }

  const metadata = {
    msg: [`Aada: Canceled ${actionName} order.`],
  }

  const walletAddress = await lucid.wallet.address()
  const walletDetails = getAddressDetails(walletAddress)

  const txBuilder = tx
    .collectFrom(
      [batcherUtxo],
      Data.to(batcherRedeemer, OrderContractDepositOrderContract.redeemer),
    )
    .addSignerKey(walletDetails.paymentCredential!.hash)
    .attachSpendingValidator(validator)
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo)
    .attachMetadata(674, metadata)

  return { txBuilder }
}
