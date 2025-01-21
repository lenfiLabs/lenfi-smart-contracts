use aada/nft_pointers
use aada/types.{AssetClass}
use aada/types/oracle.{OraclePriceFeed, OracleRedeemer}
use aiken/builtin
use aiken/collection/list
use cardano/address.{Inline}
use cardano/script_context.{ScriptInfo, Withdrawing}
use cardano/transaction.{OutputReference, Spend, Transaction}

validator oracle_validatorv(
  verification_keys: List<ByteArray>,
  threshold: Int,
  _oracle_asset: AssetClass,
  governance_token: AssetClass,
) {
  // Allow to move Oracle NFT if governance have signed off.
  spend(
    _datum: Option<Data>,
    _r,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Transaction { withdrawals, reference_inputs, extra_signatories, .. } =
      transaction
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
  withdraw(redeemer: OracleRedeemer, transaction: Transaction, info: ScriptInfo) {
    // expect ScriptContext {
    //   transaction: Transaction { .. },
    //   purpose: WithdrawFrom(Inline(_own_credential)),
    // } = ctx

    expect Withdrawing(_own_credential) = info

    let unique_signatures = list.unique(redeemer.signatures)
    let valid_signatures =
      list.foldl(
        unique_signatures,
        0,
        fn(redem, valid_signatures) -> Int {
          expect Some(verification_key) =
            list.at(verification_keys, redem.key_position)
          if builtin.verify_ed25519_signature(
            verification_key,
            builtin.serialise_data(redeemer.data),
            redem.signature,
          ) {
            valid_signatures + 1
          } else {
            valid_signatures
          }
        },
      )
    valid_signatures >= threshold
  }

  else(_) {
    fail
  }
}

// this is unused, only used to access the type in blueprints
validator feed_type {
  spend(
    _datum: Option<Data>,
    _redeemer: OraclePriceFeed,
    own_ref: OutputReference,
    _transaction: Transaction,
  ) {
    False
  }

  else(_) {
    fail
  }
}
