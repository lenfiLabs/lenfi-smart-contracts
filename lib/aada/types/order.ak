use aada/types.{AssetClass, POSIXTime}
use aiken/transaction.{Output, OutputReference}
use aiken/transaction/credential.{Address, Credential}
use aiken/transaction/value.{PolicyId, Value}

pub type Redeemer<additional_data> {
  Cancel
  Process { pool_oref: OutputReference, additional_data: additional_data }
}

// proceed passes the specific pool utxo we're spending.
// this makes it cheaper to search for the pool.

// output that you add one extra token to, cannot have refscript.
pub type PartialOutput {
  address: Address,
  value: Value,
  datum: transaction.Datum,
}

pub type ProcessBorrow {
  borrower_token_name: ByteArray,
  additional_ada: Int,
}

pub type Datum<order_type> {
  control_credential: Credential,
  pool_nft_cs: AssetClass,
  batcher_fee_ada: Int,
  order: order_type,
}

// amount that you deposit calculates the lp tokens you should receive
pub type DepositRequest {
  deposit_amount: Int,
  partial_output: PartialOutput,
  lp_asset: AssetClass,
}

// the amount of lp tokens you burn is used to calculate the amount of deposit you redeem
pub type WithdrawRequest {
  lp_tokens_burn: Int,
  // Output.value == PartialOutput.value + calculated_withdrawal_amount
  partial_output: PartialOutput,
  receive_asset: AssetClass,
  lp_asset: AssetClass,
}

// Borrower wants to receive loan, store collateral safely, receive right (NFT) to collateral
pub type BorrowRequest {
  expected_output: Output,
  partial_output: PartialOutput,
  borrower_nft_policy: PolicyId,
  min_collateral_amount: Int,
  min_deposit_time: POSIXTime,
  max_interest_rate: Int,
  collateral_address: Address,
}

// when you repay, you expect to receive an output back, spend and consume the collateral, and burn the bond
pub type RepayRequest {
  expected_output: Output,
  order: OutputReference,
  burn_asset: AssetClass,
}

// when you liquidate, you expect to provide
pub type LiquidateRequest {
  expected_output: Output,
}
