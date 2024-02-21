use aada/nft_pointers
use aada/types.{AssetClass}
use aada/types/oracle.{OraclePriceFeed, OracleRedeemer}
use aiken/builtin
use aiken/list
use aiken/transaction.{ScriptContext, Spend, Transaction, WithdrawFrom}
use aiken/transaction/credential.{Inline}

validator(
  verification_keys: List<ByteArray>,
  threshold: Int,
  _oracle_asset: AssetClass,
  governance_token: AssetClass,
) {
  // Allow to move Oracle NFT if governance have signed off.
  fn spend(_datum: Data, _r, ctx: ScriptContext) {
    expect ScriptContext {
      transaction: Transaction {
        withdrawals,
        reference_inputs,
        extra_signatories,
        ..
      },
      purpose: Spend(_own_oref),
    } = ctx
    // Governance approval (transaction signed by governance NFT holder)
    nft_pointers.nft_validator(
      governance_token.policy_id,
      governance_token.asset_name,
      reference_inputs,
      withdrawals,
      extra_signatories,
    )
  }

  // Validate that n/m oracles have signed on this TX
  fn withdraw_validate(redeemer: OracleRedeemer, ctx: ScriptContext) -> Bool {
    expect ScriptContext {
      transaction: Transaction { .. },
      purpose: WithdrawFrom(Inline(_own_credential)),
    } = ctx

    let unique_signatures = list.unique(redeemer.signatures)
    let valid_signatures =
      list.foldl(
        unique_signatures,
        0,
        fn(redem, valid_signatures) -> Int {
          expect Some(verification_key) =
            list.at(verification_keys, redem.key_position)
          if
          builtin.verify_ed25519_signature(
            verification_key,
            builtin.serialise_data(redeemer.data),
            redem.signature,
          ){
          
            valid_signatures + 1
          } else {
            valid_signatures
          }
        },
      )
    valid_signatures >= threshold
  }
}

// this is unused, only used to access the type in blueprints
validator {
  fn feed_type(_redeemer: OraclePriceFeed, _ctx: ScriptContext) -> Bool {
    False
  }
}
