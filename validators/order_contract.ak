//// 1. Supply/Deposit - Lender deposits tokens - receives LP tokens
//// 2. Withdraw - Lender burns LP tokens - receives deposit tokens
//// 3. Borrow - Borrower deposits collateral - receives borrower NFT + loan
//// 4. Repay - Borrower deposits Loan + NFT - receives collateral
//// 5. Liquidate - Someone deposits Loan tokens, receives a piece of collateral

use aada/types.{Wrapped, WrappedRedeemer}
use aada/types/collateral
use aada/types/order
use aada/types/pool
use aada/utils
use aiken/dict
use aiken/list
use aiken/math
use aiken/transaction.{
  Datum, InlineDatum, Input, NoDatum, Output, OutputReference, ScriptContext,
  Spend, Transaction,
}
use aiken/transaction/credential.{VerificationKeyCredential}
use aiken/transaction/value.{from_minted_value, quantity_of}

fn order_wrapper(
  lambda: fn(b, pool.Action) -> Bool,
  datum: order.Datum<a>,
  redeemer: order.Redeemer<b>,
  ctx: ScriptContext,
) {
  let ScriptContext {
    transaction: Transaction {
      inputs,
      redeemers,
      extra_signatories,
      withdrawals,
      ..
    },
    purpose,
  } = ctx
  expect Spend(this_oref) = purpose
  when redeemer is {
    order.Cancel ->
      utils.authorized_by_credential(
        extra_signatories,
        withdrawals,
        datum.control_credential,
      )
    order.Process { pool_oref, additional_data } -> {
      expect Some(Input { output: Output { value: pool_output_value, .. }, .. }) =
        list.find(inputs, fn(inp) -> Bool { inp.output_reference == pool_oref })
      expect Some(raw_pool_redeemer): Option<Data> =
        dict.get(redeemers, Spend(pool_oref))
      expect Wrapped(pool.Redeemer { action, order, .. }): WrappedRedeemer<
        pool.Redeemer,
      > = raw_pool_redeemer
      let pool_nft_found =
        quantity_of(
          pool_output_value,
          datum.pool_nft_cs.policy_id,
          datum.pool_nft_cs.asset_name,
        ) == 1
      let pool_tagged_this = order == Some(this_oref)
      and {
        pool_nft_found?,
        pool_tagged_this?,
        lambda(additional_data, action)?,
      }
    }
  }
}

validator {
  fn deposit_order_contract(
    datum: order.Datum<order.DepositRequest>,
    redeemer: order.Redeemer<Void>,
    ctx: ScriptContext,
  ) -> Bool {
    fn(_: Void, pool_action: pool.Action) -> Bool {
      when pool_action is {
        pool.Continuing(pool.LpAdjust { value_delta, .. }) -> {
          let order.DepositRequest {
            deposit_amount,
            partial_output: order.PartialOutput {
              address,
              value,
              datum: order_datum,
            },
            lp_asset,
          } = datum.order
          // All minted assets go to depositor since only one interaction with the pool on the TX
          let lp_assets_minted =
            quantity_of(
              from_minted_value(ctx.transaction.mint),
              lp_asset.policy_id,
              lp_asset.asset_name,
            )

          let real_output = {
            expect Spend(this_oref) = ctx.purpose

            let expected_datum =
              when order_datum is {
                NoDatum -> InlineDatum(this_oref)
                _ -> order_datum
              }
            Output {
              address,
              value: value.add(
                value,
                lp_asset.policy_id,
                lp_asset.asset_name,
                lp_assets_minted,
              ),
              datum: expected_datum,
              reference_script: None,
            }
          }

          let user_received_value =
            ctx.transaction.outputs
              |> list.any(fn(out) { out == real_output })
          and {
            user_received_value?,
            (value_delta == deposit_amount)?,
          }
        }
        _ -> False
      }
    }
      |> order_wrapper(datum, redeemer, ctx)
  }
}

validator {
  fn withdraw_order_contract(
    datum: order.Datum<order.WithdrawRequest>,
    redeemer: order.Redeemer<Void>,
    ctx: ScriptContext,
  ) -> Bool {
    fn(_: Void, pool_action: pool.Action) -> Bool {
      when pool_action is {
        pool.Continuing(pool.LpAdjust { value_delta, .. }) -> {
          let order.WithdrawRequest {
            lp_tokens_burn,
            partial_output: order.PartialOutput { address, value, datum },
            receive_asset,
            lp_asset,
          } = datum.order

          let burnt_asset =
            quantity_of(
              from_minted_value(ctx.transaction.mint),
              lp_asset.policy_id,
              lp_asset.asset_name,
            ) == -lp_tokens_burn

          let real_output =
            when address.payment_credential is {
              VerificationKeyCredential(_) -> {
                expect Spend(this_oref) = ctx.purpose
                let expected_datum: OutputReference = this_oref
                let expected_datum: Datum = InlineDatum(expected_datum)

                Output {
                  address,
                  value: value.add(
                    value,
                    receive_asset.policy_id,
                    receive_asset.asset_name,
                    -value_delta,
                  ),
                  datum: expected_datum,
                  reference_script: None,
                }
              }
              _ ->
                Output {
                  address,
                  value: value.add(
                    value,
                    receive_asset.policy_id,
                    receive_asset.asset_name,
                    -value_delta,
                  ),
                  datum,
                  reference_script: None,
                }
            }
          let user_received_value =
            ctx.transaction.outputs
              |> list.any(fn(out) { out == real_output })
          and {
            user_received_value?,
            burnt_asset?,
          }
        }
        _ -> False
      }
    }
      |> order_wrapper(datum, redeemer, ctx)
  }
}

validator {
  fn borrow_order_contract(
    datum: order.Datum<order.BorrowRequest>,
    redeemer: order.Redeemer<order.ProcessBorrow>,
    ctx: ScriptContext,
  ) -> Bool {
    expect Spend(this_oref) = ctx.purpose
    fn(borrow_redeemer, pool_action: pool.Action) -> Bool {
      when pool_action is {
        pool.Continuing(pool.Borrow {
          interest_rate,
          collateral_amount,
          loan_amount: loan_amount_sent_to_pool,
          ..
        }) -> {
          expect Some(this_input) =
            list.find(
              ctx.transaction.inputs,
              fn(inp) { inp.output_reference == this_oref },
            )
          let order.BorrowRequest {
            borrower_nft_policy,
            expected_output,
            partial_output: order.PartialOutput {
              address,
              value: partial_output_value,
              datum,
            },
            max_interest_rate,
            min_deposit_time,
            min_collateral_amount,
            collateral_address,
          } = datum.order
          let order.ProcessBorrow(borrower_token_name, additional_ada) =
            borrow_redeemer
          // Lender must receive the LPs
          let user_received_value =
            list.any(
              ctx.transaction.outputs,
              fn(out) { out == expected_output },
            )
          // because the nft policy only mints one at a time, we know this is unique.
          let borrower_token_minted =
            quantity_of(
              from_minted_value(ctx.transaction.mint),
              borrower_nft_policy,
              borrower_token_name,
            ) == 1
          let expected_recipient_output =
            Output {
              address,
              value: value.add(
                value.add(
                  partial_output_value,
                  borrower_nft_policy,
                  borrower_token_name,
                  1,
                ),
                "",
                "",
                math.abs(additional_ada),
              ),
              datum,
              reference_script: None,
            }
          let recipient_got_borrow_nft =
            list.any(
              ctx.transaction.outputs,
              fn(out) { out == expected_recipient_output },
            )
          let collateral_output_match =
            (
              list.filter(
                ctx.transaction.outputs,
                fn(out) {
                  let Output { address: addr, datum: the_datum, .. } = out
                  when the_datum is {
                    InlineDatum(col_datum) ->
                      if addr == collateral_address {
                        expect collateral_datum: collateral.CollateralDatum =
                          col_datum
                        let tag_matches =
                          collateral_datum.tag == Some(this_oref)
                        let valid_loan_start_time =
                          collateral_datum.deposit_time >= min_deposit_time
                        let valid_loan_amount =
                          if collateral_datum.loan_cs.policy_id == "" {
                            loan_amount_sent_to_pool >= quantity_of(
                              this_input.output.value,
                              collateral_datum.loan_cs.policy_id,
                              collateral_datum.loan_cs.asset_name,
                            ) - math.abs(additional_ada)
                          } else {
                            loan_amount_sent_to_pool >= quantity_of(
                              this_input.output.value,
                              collateral_datum.loan_cs.policy_id,
                              collateral_datum.loan_cs.asset_name,
                            )
                          }
                        and {
                          valid_loan_amount?,
                          tag_matches?,
                          valid_loan_start_time?,
                        }
                      } else {
                        False
                      }
                    _ -> False
                  }
                },
              )
                |> list.length
            ) == 1
          let valid_interest_rate = interest_rate <= max_interest_rate
          let valid_pool_collateral_amount =
            collateral_amount >= min_collateral_amount
          and {
            valid_interest_rate?,
            valid_pool_collateral_amount?,
            borrower_token_minted?,
            recipient_got_borrow_nft?,
            user_received_value?,
            collateral_output_match?,
          }
        }
        _ -> False
      }
    }
      |> order_wrapper(datum, redeemer, ctx)
  }
}

validator {
  fn repay_order_contract(
    datum: order.Datum<order.RepayRequest>,
    redeemer: order.Redeemer<Void>,
    ctx: ScriptContext,
  ) -> Bool {
    fn(_: Void, pool_action: pool.Action) -> Bool {
      when pool_action is {
        pool.Continuing(pool.CloseLoan { .. }) -> {
          let order.RepayRequest { expected_output, order, burn_asset } =
            datum.order
          let received_expected_output =
            list.any(
              ctx.transaction.outputs,
              fn(out) { out == expected_output },
            )
          let consumed_order =
            list.any(
              ctx.transaction.inputs,
              fn(input) { input.output_reference == order },
            )
          let burnt_enough =
            quantity_of(
              from_minted_value(ctx.transaction.mint),
              burn_asset.policy_id,
              burn_asset.asset_name,
            ) == -1
          and {
            received_expected_output?,
            consumed_order?,
            burnt_enough?,
          }
        }
        _ -> False
      }
    }
      |> order_wrapper(datum, redeemer, ctx)
  }
}

// this is unused, only used to access the type in blueprints
validator {
  fn outputRefType(_redeemer: OutputReference, _ctx: ScriptContext) -> Bool {
    False
  }
}
