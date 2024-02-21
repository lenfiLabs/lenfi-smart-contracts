use aada/finance
use aada/types.{AssetClass, Wrapped, WrappedRedeemer}
use aada/types/oracle.{Aggregated, Pooled}
use aada/types/pool
use aada/types/pool_stake
use aada/utils
use aiken/cbor
use aiken/dict
use aiken/interval.{Finite}
use aiken/list
use aiken/math/rational
use aiken/transaction.{
  InlineDatum, OutputReference, Publish, ScriptContext, Spend, Transaction,
  WithdrawFrom,
}
use aiken/transaction/certificate.{
  CredentialDelegation, CredentialDeregistration, CredentialRegistration,
}
use aiken/transaction/credential.{Inline, ScriptCredential}
use aiken/transaction/value.{PolicyId, from_minted_value, quantity_of}

fn pool_stake_publish(
  delegation_nft: AssetClass,
  certificate,
  redeemer: pool_stake.PublishRedeemer,
  transaction,
) -> Bool {
  let Transaction { inputs, .. } = transaction
  let pool_stake.PublishRedeemer(pool_owner_oref) = redeemer
  when certificate is {
    CredentialRegistration { .. } | CredentialDelegation { .. } | CredentialDeregistration { .. } -> {
      expect Some(inp) =
        inputs |> list.find(fn(out) { out.output_reference == pool_owner_oref })
      let nft_check =
        quantity_of(
          inp.output.value,
          delegation_nft.policy_id,
          delegation_nft.asset_name,
        ) == 1
      nft_check
    }
    _ -> False
  }
}

fn pool_stake_withdraw(
  pool_nft_policy,
  withdraw_credentials,
  redeemer: pool_stake.WithdrawalRedeemer,
  transaction,
) -> Bool {
  let Transaction {
    inputs,
    withdrawals,
    redeemers,
    reference_inputs,
    validity_range,
    ..
  } = transaction

  let pool_stake.WithdrawalRedeemer(action, pool_oref) = redeemer

  expect Some(pool_input) =
    inputs |> list.find(fn(out) { out.output_reference == pool_oref })

  expect Inline(own_credentials) = withdraw_credentials

  expect ScriptCredential(own_hash) = own_credentials

  let nft_check =
    quantity_of(pool_input.output.value, pool_nft_policy, own_hash) == 1

  expect InlineDatum(pool_datum) = pool_input.output.datum
  expect pool_datum: pool.Datum = pool_datum

  expect Finite(upper_bound) = validity_range.upper_bound.bound_type
  expect Some(current_withdrawal_amount) =
    dict.get(withdrawals, withdraw_credentials)

  let current_withdrawal_fee_adjusted = current_withdrawal_amount - 2_000_000

  expect Some(raw_pool_redeemer): Option<Data> =
    redeemers |> dict.get(Spend(pool_oref))

  expect Wrapped(pool_redeemer): WrappedRedeemer<pool.Redeemer> =
    raw_pool_redeemer
  expect pool.Continuing(continuing_action) = pool_redeemer.action
  expect pool.PayFee(fee_amount, ..) = continuing_action

  let asset_is_ada = pool_datum.params.loan_cs.policy_id == #""
  trace cbor.diagnostic(fee_amount)
  trace cbor.diagnostic(current_withdrawal_fee_adjusted)

  when action is {
    pool_stake.ExactWithdrawal -> {
      let amount_check = fee_amount >= current_withdrawal_fee_adjusted
      // allowing withdrawer to keep 2ADA
      and {
        amount_check?,
        nft_check?,
        asset_is_ada?,
      }
    }
    // Only if ADA is the loan token.
    pool_stake.SwapWithdrawal -> {
      let expected_deposit_amount: Int =
        if asset_is_ada {
          current_withdrawal_fee_adjusted
        } else {
          // Figure out how much tokens can be purchased with the withdrawal amount
          // Sell ADA for loan tokens
          expect Some(loan_tokens_price) =
            utils.retrieve_oracle_data(
              reference_inputs,
              pool_datum.params.oracle_loan_asset,
              redeemers,
              upper_bound,
            )
          when loan_tokens_price is {
            Aggregated(aggregated_data) -> {
              expect Some(token_price) =
                rational.new(
                  aggregated_data.token_price_in_lovelaces,
                  aggregated_data.denominator,
                )
              let current_withdrawal_fee_adjusted_rat =
                rational.from_int(current_withdrawal_fee_adjusted)
              expect Some(withdrawal_value) =
                rational.div(current_withdrawal_fee_adjusted_rat, token_price)

              withdrawal_value |> rational.truncate()
            }
            Pooled(pooled_data) ->
              finance.token_b_received_from_seling_token_a(
                current_withdrawal_fee_adjusted |> rational.from_int(),
                pooled_data.token_b_amount,
                pooled_data.token_a_amount,
              )
          }
        }
      trace cbor.diagnostic(expected_deposit_amount)
      let amount_check = expected_deposit_amount <= fee_amount
      and {
        amount_check?,
        nft_check?,
      }
    }
  }
}

validator(
  pool_nft_policy: PolicyId,
  delegation_nft: AssetClass,
  utxo_to_consume: OutputReference,
) {
  fn pool_stake(redeemer: pool_stake.StakeRedeemer, ctx: ScriptContext) {
    let ScriptContext { transaction, purpose } = ctx
    when redeemer is {
      pool_stake.Publish(publish_redeemer) -> {
        expect Publish(certificate) = purpose
        pool_stake_publish(
          delegation_nft,
          certificate,
          publish_redeemer,
          transaction,
        )
      }
      pool_stake.Withdraw(withdrawal_redeemer) -> {
        expect WithdrawFrom(withdraw_credentials) = purpose
        pool_stake_withdraw(
          pool_nft_policy,
          withdraw_credentials,
          withdrawal_redeemer,
          transaction,
        )
      }
      pool_stake.CreatePool(consumed_utxo) -> {
        expect Publish(certificate) = purpose
        // expect CredentialRegistration { delegator } = certificate
        expect CredentialDelegation(delegator, _pool) = certificate
        expect Inline(own_script) = delegator
        expect ScriptCredential(own_hash) = own_script

        let mint_value = from_minted_value(transaction.mint)
        let valid_nft_check =
          quantity_of(mint_value, pool_nft_policy, own_hash) == 1
        let consumed_utxo_check =
          list.any(
            transaction.inputs,
            fn(input) { input.output_reference == consumed_utxo },
          )

        and {
          consumed_utxo_check,
          valid_nft_check,
          utxo_to_consume == consumed_utxo,
        }
      }
    }
  }
}
