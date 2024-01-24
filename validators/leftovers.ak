use aada/types.{AssetClass}
use aada/types/leftovers.{LeftoversDatum}
use aada/utils
use aiken/transaction.{ScriptContext}

validator {
  fn leftovers(datum: LeftoversDatum, _r: Void, ctx: ScriptContext) {
    let AssetClass { policy_id, asset_name } = datum
    utils.validate_mint_nft(ctx.transaction.mint, policy_id, asset_name, -1)
  }
}
