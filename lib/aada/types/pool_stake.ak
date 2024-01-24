use aada/types.{AssetClass}
use aiken/transaction.{OutputReference}
use aiken/transaction/value.{AssetName}

// suggestion: wrap every int in a newtype
// this way name can be less descriptive, and you
// won't screw up the order of the fields when destructuring
pub type StakeDatum {
  pool_nft_name: AssetName,
  staked_asset_cs: AssetClass,
  balance: Int,
  reward_asset_cs: AssetClass,
  reward_actual_balance: Int,
  rewards_balance: Int,
  lp_token_cs: AssetClass,
  total_lp_tokens: Int,
  stake_deadline: Int,
  reward_deposit_gap: Int,
  rewards_claim_start: Int,
}

pub type WithdrawalAction {
  ExactWithdrawal
  SwapWithdrawal
}

pub type PublishRedeemer {
  pool_owner_oref: OutputReference,
}

pub type WithdrawalRedeemer {
  action: WithdrawalAction,
  pool_oref: OutputReference,
}

pub type StakeRedeemer {
  Publish(PublishRedeemer)
  Withdraw(WithdrawalRedeemer)
  CreatePool(OutputReference)
}
