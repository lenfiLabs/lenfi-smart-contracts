use aada/types.{Wrapped, WrappedRedeemer}
use aada/types/collateral.{MergeDatum}
use aada/types/pool
use aada/utils
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential, Inline, Script}
use cardano/script_context.{ScriptInfo, Withdrawing}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Spend, Transaction,
}

validator delayed_mergev(pool_script_hash: ByteArray) {
  spend(
    _datum: Option<MergeDatum>,
    _r,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, withdrawals, .. } = transaction

    expect Some(own_input) =
      list.find(inputs, fn(input) { input.output_reference == own_ref })

    let withdraw_cred = own_input.output.address.payment_credential

    // Can spend ALL THE merge inputs if ALL THE withdrawals are valid
    pairs.has_key(withdrawals, withdraw_cred)
  }

  withdraw(
    pool_nft_name_redeemer: ByteArray,
    transaction: Transaction,
    info: ScriptInfo,
  ) {
    let Transaction { inputs, redeemers, .. } = transaction
    expect Withdrawing(own_credential) = info

    let pool_input =
      utils.get_input_by_nft(inputs, pool_script_hash, pool_nft_name_redeemer)
    let pool_oref = pool_input.output_reference
    expect [raw_pool_redeemer] = redeemers |> pair.get_all(Spend(pool_oref))
    expect raw_pool_redeemer: Optioon<Data> = raw_pool_redeemer

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
            // Sum multiple repayments if it's present
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
            // Sum multiple loans if it's present
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

  else(_) {
    fail
  }
}
