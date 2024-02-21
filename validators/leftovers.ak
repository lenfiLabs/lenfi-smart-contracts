use aada/types.{AssetClass}
use aada/types/leftovers.{LeftoversDatum}
use aada/utils
use aiken/transaction.{ScriptContext}

// You can spend from this contract whenever NFT is burned. 
// Only one NFT per transaction
// Contract is used to save deployed validators when creating the pool and to save Borrowers remaining collateral after liquidation
validator {
  fn leftovers(datum: LeftoversDatum, _r: Void, ctx: ScriptContext) {
    let AssetClass { policy_id, asset_name } = datum
    utils.validate_mint_nft(ctx.transaction.mint, policy_id, asset_name, -1)
  }
}
