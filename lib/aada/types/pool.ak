use aada/types.{AssetClass}
use aiken/transaction.{OutputReference}
use aiken/transaction/credential.{Address}
use aiken/transaction/value.{AssetName}

pub type OutputIndex =
  Int

pub type PoolCreateDetails {
  output_index: Int,
  initial_pool_delegation: ByteArray,
}

pub type PoolNFTAction {
  MintPoolNFT(PoolCreateDetails)
  BurnPoolNFT(ByteArray)
}

pub type Redeemer {
  action: Action,
  config_ref: OutputReference,
  order: Option<OutputReference>,
}

pub type Action {
  Continuing(ContinuingAction)
  Destroy
}

pub type ContinuingAction {
  LpAdjust { value_delta: Int, continuing_output: OutputIndex }
  Borrow {
    loan_amount: Int,
    collateral_amount: Int,
    borrower_tn: AssetName,
    interest_rate: Int,
    continuing_output: OutputIndex,
  }
  CloseLoan {
    loan_amount: Int,
    repay_amount: Int,
    continuing_output: OutputIndex,
  }
  PayFee { fee: Int, continuing_output: OutputIndex }
}

pub type Datum {
  params: Constants,
  balance: Int,
  lent_out: Int,
  total_lp_tokens: Int,
}

pub type InterestParams {
  optimal_utilization: Int,
  base_interest_rate: Int,
  rslope1: Int,
  rslope2: Int,
}

pub type Constants {
  collateral_address: Address,
  loan_cs: AssetClass,
  collateral_cs: AssetClass,
  oracle_collateral_asset: AssetClass,
  oracle_loan_asset: AssetClass,
  lp_token: AssetClass,
  pool_nft_name: AssetName,
  pool_config_assetname: AssetName,
}

pub type Config {
  liquidation_threshold: Int,
  initial_collateral_ratio: Int,
  pool_fee: Int,
  loan_fee_details: PlatformFeeDetails,
  merge_action_fee: Int,
  min_transition: Int,
  min_loan: Int,
  min_fee: Int,
  min_liquidation_fee: Int,
  interest_params: InterestParams,
}

pub type PlatformFeeDetails {
  tier_1_fee: Int,
  tier_1_threshold: Int,
  tier_2_fee: Int,
  tier_2_threshold: Int,
  tier_3_fee: Int,
  tier_3_threshold: Int,
  liquidation_fee: Int,
  platform_fee_collector_address: Address,
}
