use aada/types.{Wrapped, WrappedRedeemer}
use aada/types/collateral.{MergeDatum}
use aada/types/pool
use aada/utils
use aiken/dict
use aiken/list
use aiken/transaction.{
  InlineDatum, Input, Output, ScriptContext, Spend, Transaction, WithdrawFrom,
}
use aiken/transaction/credential.{Inline}

validator(pool_script_hash: ByteArray) {
  fn spend(_datum: MergeDatum, _r, ctx: ScriptContext) {
    expect ScriptContext {
      transaction: Transaction { inputs, withdrawals, .. },
      purpose: Spend(own_oref),
    } = ctx
    expect Some(own_input) =
      list.find(inputs, fn(input) { input.output_reference == own_oref })

    let withdraw_cred = Inline(own_input.output.address.payment_credential)
    // Can spend ALL THE merge inputs if ALL THE withdrawals are valid
    dict.has_key(withdrawals, withdraw_cred)
  }

  fn withdraw_validate(
    pool_nft_name_redeemer: ByteArray,
    ctx: ScriptContext,
  ) -> Bool {
    expect ScriptContext {
      transaction: Transaction { inputs, redeemers, .. },
      purpose: WithdrawFrom(Inline(own_credential)),
    } = ctx
    let pool_input =
      utils.get_input_by_nft(inputs, pool_script_hash, pool_nft_name_redeemer)
    let pool_oref = pool_input.output_reference
    expect Some(raw_pool_redeemer): Option<Data> =
      redeemers |> dict.get(Spend(pool_oref))

    expect Wrapped(pool_redeemer): WrappedRedeemer<pool.Redeemer> =
      raw_pool_redeemer

    when pool_redeemer.action is {
      pool.Continuing(continuing_action) ->
        when continuing_action is {
          pool.CloseLoan(loan_amount, repay_amount, ..) -> {
            let merges =
              list.filter(
                inputs,
                fn(input) {
                  let is_own_credential =
                    input.output.address.payment_credential == own_credential
                  if is_own_credential {
                    expect InlineDatum(merge_datum) = input.output.datum
                    expect MergeDatum { pool_nft_name, .. }: MergeDatum =
                      merge_datum
                    let pool_nft_match = pool_nft_name == pool_nft_name_redeemer
                    and {
                      is_own_credential?,
                      pool_nft_match?,
                    }
                  } else {
                    False
                  }
                },
              )
            // Sum the totals of merges
            let total_repay_amount =
              list.foldl(
                merges,
                0,
                fn(input, total) {
                  let Input { output: Output { datum: merge_datum, .. }, .. } =
                    input
                  expect InlineDatum(merge_datum) = merge_datum
                  expect merge_datum: MergeDatum = merge_datum
                  expect merge_datum.repay_amount > 0
                  merge_datum.repay_amount + total
                },
              )
            let total_loan_amount =
              list.foldl(
                merges,
                0,
                fn(input, total) {
                  let Input { output: Output { datum: merge_datum, .. }, .. } =
                    input
                  expect InlineDatum(merge_datum) = merge_datum
                  expect merge_datum: MergeDatum = merge_datum
                  expect merge_datum.loan_amount > 0
                  merge_datum.loan_amount + total
                },
              )

            let loan_amt_check = loan_amount == total_loan_amount
            let repay_amt_check = repay_amount == total_repay_amount
            and {
              loan_amt_check?,
              repay_amt_check?,
            }
          }
          _ -> False
        }
      _ -> False
    }
  }
}
