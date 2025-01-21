use aada/types.{AssetClass}
use aada/types/leftovers.{LeftoversDatum}
use aada/utils
use cardano/transaction.{OutputReference, Transaction}

// You can spend from this contract whenever NFT is burned. 
// Only one NFT per transaction
// Contract is used to save deployed validators when creating the pool and to save Borrowers remaining collateral after liquidation
validator leftoversv {
  spend(
    datum: Option<LeftoversDatum>,
    _r: Void,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(datum) = datum
    let AssetClass { policy_id, asset_name } = datum
    utils.validate_mint_nft(transaction.mint, policy_id, asset_name, -1)
  }

  else(_) {
    fail
  }
}
