use aada/types.{AssetClass, POSIXTime}
use aada/types/pool
use aiken/transaction.{OutputReference}
use aiken/transaction/value.{AssetName}

pub type CollateralDatum {
  pool_nft_name: AssetName,
  loan_cs: AssetClass,
  loan_amount: Int,
  pool_config: pool.Config,
  collateral_cs: AssetClass,
  collateral_amount: Int,
  interest_rate: Int,
  lent_out: Int,
  balance: Int,
  deposit_time: POSIXTime,
  borrower_tn: AssetName,
  oracle_collateral_asset: AssetClass,
  oracle_loan_asset: AssetClass,
  tag: Option<OutputReference>,
}

// Optionally (in the case of burning), a reference to the collateral UTxO
pub type CollateralNFTInner =
  Option<OutputReference>

pub type MergeDatum {
  borrower_tn: AssetName,
  pool_nft_name: ByteArray,
  repay_amount: Int,
  loan_amount: Int,
  collateral_oref: OutputReference,
}
