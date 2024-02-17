use aada/finance
use aada/nft.{BurnNFTElem,
  CollateralNFTRedeemerLists, MintNFTElem, id_from_utxo}
use aada/types.{AssetClass, Wrapped, WrappedRedeemer}
use aada/types/collateral.{CollateralDatum, MergeDatum}
use aada/types/leftovers.{LeftoversDatum}
use aada/types/oracle.{Aggregated, Pooled}
use aada/types/pool
use aada/utils
use aiken/dict
use aiken/interval.{Finite}
use aiken/list
use aiken/math/rational
use aiken/option
// Collateral is makes sure that loan is repaid fairly before allowing to take collateral.
// Also collateral is a friend of lender since Collateral, not Pool cares about the interest and loan

use aiken/transaction.{
  Datum, InlineDatum, Input, Mint, Output, OutputReference, ScriptContext, Spend,
  Transaction,
}
use aiken/transaction/credential.{Address, ScriptCredential}
use aiken/transaction/value.{flatten, from_minted_value, quantity_of, tokens}

type CollateralRedeemer {
  action: CollateralRedeemerType,
  interest: Int,
  merge_type: CollateralMergeType,
}

// If liquidation - oracle data is needed.
type CollateralRedeemerType {
  CollateralRepay
  CollateralLiquidate(Int)
}

type DelayedMergeValues {
  output_index: Int,
  amount_repaying: Int,
}

type CollateralMergeType {
  // WithPool happens with pool utxo in same transaction
  ImmediateWithPool(OutputReference)
  // Sharded doesn't have pool in same transaction, and produces output at a merging script
  DelayedIntoPool(DelayedMergeValues)
}

fn get_platform_fee(
  collateral_datum: CollateralDatum,
  // pool_input_datum: pool.Datum,
  platform_fee_datum: pool.PlatformFeeDetails,
) -> Int {
  expect Some(utilization_rate) =
    collateral_datum.loan_amount * 1000000
      |> rational.new(collateral_datum.lent_out + collateral_datum.balance)

  if
  (
    utilization_rate
      |> rational.compare(rational.from_int(platform_fee_datum.tier_1_threshold))
  ) == Less{
  
    platform_fee_datum.tier_1_fee
  } else if (
    utilization_rate
      |> rational.compare(rational.from_int(platform_fee_datum.tier_2_threshold))
  ) == Less {
    platform_fee_datum.tier_2_fee
  } else {
    platform_fee_datum.tier_3_fee
  }
}

type CollateralParams {
  pool_script_hash: ByteArray,
  liquidations_pkh: ByteArray,
  param_merge_script_hash: ByteArray,
}

validator(collateral_script_params: CollateralParams) {
  fn spend(
    datum: CollateralDatum,
    redeemer: CollateralRedeemer,
    ctx: ScriptContext,
  ) {
    let CollateralParams {
      pool_script_hash,
      liquidations_pkh,
      param_merge_script_hash,
    } = collateral_script_params
    let ScriptContext {
      transaction: Transaction {
        validity_range,
        inputs,
        outputs,
        redeemers,
        reference_inputs,
        ..
      },
      purpose,
    } = ctx
    expect Spend(this_oref) = purpose

    expect Finite(lower_bound) = validity_range.lower_bound.bound_type
    expect Finite(upper_bound) = validity_range.upper_bound.bound_type

    let valid_validity_range = upper_bound - lower_bound <= 3600000

    let CollateralDatum { pool_nft_name, borrower_tn, .. } = datum
    let pool.Config {
      loan_fee_details: platform_fee_details,
      liquidation_threshold,
      merge_action_fee,
      min_liquidation_fee,
      ..
    }: pool.Config = datum.pool_config
    let platform_fee_rate = get_platform_fee(datum, platform_fee_details)
    let CollateralRedeemer { action, interest: interest_amount, merge_type } =
      redeemer

    expect Some(calculated_interest_amount) =
      finance.calculate_interest_amount(
        datum.interest_rate,
        datum.loan_amount,
        datum.deposit_time,
        upper_bound,
      )

    let interest_check =
      (
        rational.from_int(interest_amount)
          |> rational.compare(calculated_interest_amount)
      ) != Less
    let interest_amount_is_positive = interest_amount > 0
    let interest_rate_is_positive = datum.interest_rate > 0
    expect Some(platform_fee_amount) =
      interest_amount * platform_fee_rate |> rational.new(1000000)
    let platform_fee_amount_int = platform_fee_amount |> rational.truncate
    let amount_to_repay =
      calculated_interest_amount
        |> rational.add(rational.from_int(datum.loan_amount))

    let platform_fee_paid =
      if platform_fee_amount_int > 0 {
        list.any(
          outputs,
          fn(p_output) {
            if
            p_output.address == platform_fee_details.platform_fee_collector_address{
            
              expect InlineDatum(output_datum) = p_output.datum
              expect constructed_datum: ByteArray = output_datum

              and {
                (quantity_of(
                  p_output.value,
                  datum.loan_cs.policy_id,
                  datum.loan_cs.asset_name,
                ) >= platform_fee_amount_int)?,
                (constructed_datum == borrower_tn)?,
              }
            } else {
              False
            }
          },
        )
      } else {
        True
      }

    expect Some(Input {
      output: Output {
        address: Address(
          ScriptCredential(collateral_script_hash),
          own_stake_key,
        ),
        ..
      },
      ..
    }) =
      list.find(inputs, fn(inp) -> Bool { inp.output_reference == this_oref })
    // add redeemer check for pool
    let confirmed_repay_amt =
      when action is {
        CollateralRepay -> {
          let nft_check =
            utils.validate_mint_nft_few_per_policy(
              ctx.transaction.mint,
              collateral_script_hash,
              datum.borrower_tn,
              -1,
            )
          let valid_repay = and {
              platform_fee_paid?,
              nft_check?,
              interest_check?,
            }
          if valid_repay {
            Some(amount_to_repay)
          } else {
            None
          }
        }
        CollateralLiquidate(liquidation_output_ref) -> {
          let ada_cs = AssetClass("", "")
          let value_to_repay =
            if datum.loan_cs.policy_id == ada_cs.policy_id {
              amount_to_repay |> rational.truncate
            } else {
              expect Some(loan_tokens_price) =
                utils.retrieve_oracle_data(
                  reference_inputs,
                  datum.oracle_loan_asset,
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

                  amount_to_repay
                    |> rational.mul(token_price)
                    |> rational.truncate
                }
                Pooled(pooled_data) ->
                  finance.token_b_needed_to_purchase_token_a(
                    amount_to_repay,
                    pooled_data.token_a_amount,
                    pooled_data.token_b_amount,
                  )
              }
            }

          let collateral_amount_rat =
            datum.collateral_amount |> rational.from_int()

          let collateral_value =
            if datum.collateral_cs.policy_id == ada_cs.policy_id {
              datum.collateral_amount
            } else {
              expect Some(collateral_tokens_price) =
                utils.retrieve_oracle_data(
                  reference_inputs,
                  datum.oracle_collateral_asset,
                  redeemers,
                  upper_bound,
                )
              when collateral_tokens_price is {
                Aggregated(aggregated_data) -> {
                  expect Some(token_price) =
                    rational.new(
                      aggregated_data.token_price_in_lovelaces,
                      aggregated_data.denominator,
                    )

                  collateral_amount_rat
                    |> rational.mul(token_price)
                    |> rational.truncate
                }
                Pooled(pooled_data) ->
                  finance.token_b_received_from_seling_token_a(
                    collateral_amount_rat,
                    pooled_data.token_a_amount,
                    pooled_data.token_b_amount,
                  )
              }
            }

          let liquidation_address =
            Address(ScriptCredential(liquidations_pkh), own_stake_key)

          expect Some(liquidation_fee) =
            rational.new(
              ( collateral_value - value_to_repay ) * platform_fee_details.liquidation_fee,
              1_000_000,
            )

          let liquidation_fee =
            if ( liquidation_fee |> rational.truncate ) < min_liquidation_fee {
              rational.from_int(min_liquidation_fee)
            } else {
              liquidation_fee
            }

          let borrower_compensation_in_ada =
            rational.from_int(collateral_value - value_to_repay)
              |> rational.sub(liquidation_fee)

          let borrower_compensation =
            if datum.collateral_cs.policy_id == ada_cs.policy_id {
              borrower_compensation_in_ada |> rational.truncate
            } else {
              expect Some(collateral_tokens_price) =
                utils.retrieve_oracle_data(
                  reference_inputs,
                  datum.oracle_collateral_asset,
                  redeemers,
                  upper_bound,
                )
              when collateral_tokens_price is {
                Aggregated(aggregated_data) -> {
                  expect Some(token_price) =
                    rational.new(
                      aggregated_data.token_price_in_lovelaces,
                      aggregated_data.denominator,
                    )
                  expect Some(val) =
                    borrower_compensation_in_ada
                      |> rational.div(token_price)
                  val
                    |> rational.truncate
                }
                Pooled(pooled_data) ->
                  finance.token_b_received_from_seling_token_a(
                    borrower_compensation_in_ada,
                    pooled_data.token_a_amount,
                    pooled_data.token_b_amount,
                  )
              }
            }

          let collateral_check =
            finance.check_is_undercollaterized(
              value_to_repay,
              collateral_value,
              liquidation_threshold,
            )

          let liquidation_output_check =
            if and {
              borrower_compensation > 0,
              collateral_check,
            } {
              let AssetClass { policy_id, asset_name } = datum.collateral_cs

              expect Some(Output { value, datum: wrapped_datum, address, .. }) =
                list.at(outputs, liquidation_output_ref)

              expect InlineDatum(raw_datum) = wrapped_datum
              let constructed_datum: LeftoversDatum =
                AssetClass {
                  policy_id: collateral_script_hash,
                  asset_name: datum.borrower_tn,
                }
              let expected_datum: Data = constructed_datum
              let dust_attack_check =
                when flatten(value) is {
                  [(_, _, _)] -> True
                  [(_, _, _), (_, _, _)] -> True
                  _ -> False
                }

              // Liquidation output can have 2 assets at most (ADA + maybe token)
              let quantity_check =
                quantity_of(value, policy_id, asset_name) >= borrower_compensation

              let datum_check = raw_datum == expected_datum
              let address_check = address == liquidation_address
              and {
                quantity_check?,
                datum_check?,
                dust_attack_check?,
                address_check?,
              }
            } else {
              True
            }

          let valid_repay = and {
              platform_fee_paid?,
              collateral_check?,
              liquidation_output_check?,
              interest_check?,
              interest_amount_is_positive?,
              interest_rate_is_positive?,
            }
          if valid_repay {
            Some(amount_to_repay)
          } else {
            None
          }
        }
      }

    when confirmed_repay_amt is {
      Some(amt_to_pay) ->
        when merge_type is {
          ImmediateWithPool(pool_oref) -> {
            // find pool
            expect Some(pool_input) =
              inputs |> list.find(fn(inp) { inp.output_reference == pool_oref })
            let pool_input_has_nft =
              quantity_of(
                pool_input.output.value,
                pool_script_hash,
                pool_nft_name,
              ) > 0
            expect Some(raw_pool_redeemer) =
              redeemers
                |> dict.get(Spend(pool_oref))

            expect Wrapped(pool_redeemer): WrappedRedeemer<pool.Redeemer> =
              raw_pool_redeemer

            let pool_receives_amt =
              when pool_redeemer.action is {
                pool.Continuing(pool.CloseLoan { loan_amount, repay_amount, .. }) -> {
                  let amt_repay_t = amt_to_pay |> rational.truncate
                  let loan_amt_check = loan_amount >= datum.loan_amount
                  let repay_amt_check = repay_amount >= amt_repay_t
                  and {
                    loan_amt_check,
                    repay_amt_check,
                  }
                }
                _ -> False
              }
            and {
              pool_input_has_nft?,
              pool_receives_amt?,
              valid_validity_range?,
            }
          }
          // Allow to repay to the pool later.
          // This is useful if pool is busy and loan can't be repaid directly to pool. 
          DelayedIntoPool(merge_values) -> {
            let merge_values: DelayedMergeValues = merge_values

            expect Some(Output {
              address,
              datum: InlineDatum(merge_datum),
              value,
              ..
            }) = outputs |> list.at(merge_values.output_index)
            expect merge_datum: MergeDatum = merge_datum
            let address_check =
              address == Address(
                ScriptCredential(param_merge_script_hash),
                own_stake_key,
              )

            let value_check =
              quantity_of(
                value,
                datum.loan_cs.policy_id,
                datum.loan_cs.asset_name,
              ) >= ( amt_to_pay |> rational.truncate ) + merge_action_fee

            // merge_action_fee is build of 2 (pool_fee + fee received for executor.)
            // Making sure that LF-100 is resolved
            let dust_attack_check =
              when flatten(value) is {
                [(_, _, _)] -> True
                [(_, _, _), (_, _, _)] -> True
                _ -> False
              }

            let valid_repayment_amt =
              merge_values.amount_repaying >= (
                amt_to_pay |> rational.truncate
              )
            let datum_check =
              merge_datum == MergeDatum {
                borrower_tn: datum.borrower_tn,
                // It is not actively used for any validation. Might be useful for double satisfaction?
                pool_nft_name,
                repay_amount: merge_values.amount_repaying,
                // Loan + interests
                loan_amount: datum.loan_amount,
                collateral_oref: this_oref,
              }
            and {
              address_check?,
              valid_repayment_amt?,
              datum_check?,
              value_check?,
              dust_attack_check?,
            }
          }
        }
      None -> False
    }
  }

  fn mint(redeemer: CollateralNFTRedeemerLists, ctx: ScriptContext) -> Bool {
    let CollateralParams { pool_script_hash, .. } = collateral_script_params
    let ScriptContext {
      transaction: Transaction {
        inputs,
        outputs,
        validity_range,
        mint,
        reference_inputs,
        redeemers,
        ..
      },
      purpose,
    } = ctx
    let mint_value = from_minted_value(mint)

    expect Mint(own_address) = purpose
    let own_scred = ScriptCredential(own_address)
    let own_mints = tokens(mint_value, own_address)

    let CollateralNFTRedeemerLists { mints, burns } = redeemer
    let num_minted_check =
      dict.size(own_mints) == list.length(mints) + list.length(burns)

    expect Finite(lower_bound) = validity_range.lower_bound.bound_type
    expect Finite(upper_bound) = validity_range.upper_bound.bound_type
    let valid_validity_range = upper_bound - lower_bound <= 3600000

    let mints_are_valid =
      list.foldl(
        mints,
        Some(inputs),
        fn(collateral_mint: MintNFTElem, curr_inputs_opt: Option<List<Input>>) -> Option<
          List<Input>,
        > {
          expect Some(curr_inputs) = curr_inputs_opt
          let MintNFTElem(pool_utxo, collateral_output_idx) = collateral_mint
          let expected_token_name = id_from_utxo(pool_utxo)
          let token_minted_amount =
            quantity_of(mint_value, own_address, expected_token_name)
          let minted_amount_check = token_minted_amount == 1
          expect Some(Output {
            datum: InlineDatum(actual_datum_output),
            value: collateral_value,
            address: collateral_address,
            ..
          }) =
            outputs
              |> list.at(collateral_output_idx)
          let collateral_at_script_check =
            collateral_address.payment_credential == own_scred
          expect CollateralDatum { pool_nft_name, tag, .. }: CollateralDatum =
            actual_datum_output
          let pruned_inputs =
            curr_inputs
              |> list.drop_while(fn(in) { in.output_reference != pool_utxo })

          expect [
            Input(
              _,
              Output {
                datum: InlineDatum(raw_pool_datum),
                address: pool_address,
                value: pool_value,
                ..
              },
            ),
            ..
          ] = pruned_inputs

          let pool_nft_check =
            quantity_of(pool_value, pool_script_hash, pool_nft_name) == 1
          expect Some(raw_pool_redeemer): Option<Data> =
            dict.get(ctx.transaction.redeemers, Spend(pool_utxo))
          expect Wrapped(pool.Redeemer {
            action: pool.Continuing(pool.Borrow {
              loan_amount,
              collateral_amount: borrowed_collateral_amount,
              interest_rate,
              borrower_tn,
              ..
            }),
            config_ref,
            ..
          }): WrappedRedeemer<pool.Redeemer> = raw_pool_redeemer
          expect Some(Input {
            output: Output { datum: InlineDatum(pool_config_datum), .. },
            ..
          }) =
            reference_inputs
              |> list.find(fn(inp) -> Bool { inp.output_reference == config_ref })
          expect pool_config: pool.Config = pool_config_datum
          expect pool.Datum {
            params: pool.Constants {
              pool_nft_name,
              loan_cs,
              collateral_cs,
              oracle_collateral_asset,
              oracle_loan_asset,
              ..
            },
            lent_out: pool_lent_out,
            balance: pool_balance,
            ..
          }: pool.Datum = raw_pool_datum

          // To validate Oracle inputs
          let valid_borrower_tn = expected_token_name == borrower_tn
          let expected_collateral_datum: Data =
            CollateralDatum {
              pool_nft_name,
              loan_cs,
              loan_amount,
              pool_config,
              collateral_cs,
              collateral_amount: borrowed_collateral_amount,
              interest_rate,
              lent_out: pool_lent_out,
              balance: pool_balance,
              deposit_time: lower_bound,
              borrower_tn,
              oracle_collateral_asset,
              oracle_loan_asset,
              tag,
            }
          let dust_attack_check =
            when flatten(collateral_value) is {
              [(_, _, _)] -> True
              [(_, _, _), (_, _, _)] -> True
              _ -> False
            }
          // Collateral output can have 2 assets at most (ADA + maybe token)
          let collateral_amount =
            quantity_of(
              collateral_value,
              collateral_cs.policy_id,
              collateral_cs.asset_name,
            )
          let collateral_amount_check =
            collateral_amount >= borrowed_collateral_amount

          let ada_cs = AssetClass("", "")
          let loan_amount_rat = rational.from_int(loan_amount)
          let loan_value =
            if loan_cs.policy_id == ada_cs.policy_id {
              loan_amount
            } else {
              expect Some(loan_tokens_price) =
                utils.retrieve_oracle_data(
                  reference_inputs,
                  oracle_loan_asset,
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
                  loan_amount_rat
                    |> rational.mul(token_price)
                    |> rational.truncate
                }
                Pooled(pooled_data) ->
                  finance.token_b_needed_to_purchase_token_a(
                    loan_amount_rat,
                    pooled_data.token_a_amount,
                    pooled_data.token_b_amount,
                  )
              }
            }
          let collateral_amount_rat = collateral_amount |> rational.from_int()
          let collateral_tokens_value =
            if collateral_cs.policy_id == ada_cs.policy_id {
              collateral_amount
            } else {
              expect Some(collateral_tokens_price) =
                utils.retrieve_oracle_data(
                  reference_inputs,
                  oracle_collateral_asset,
                  redeemers,
                  upper_bound,
                )
              when collateral_tokens_price is {
                Aggregated(aggregated_data) -> {
                  expect Some(token_price) =
                    rational.new(
                      aggregated_data.token_price_in_lovelaces,
                      aggregated_data.denominator,
                    )
                  collateral_amount_rat
                    |> rational.mul(token_price)
                    |> rational.truncate
                }

                Pooled(pooled_data) ->
                  finance.token_b_received_from_seling_token_a(
                    collateral_amount_rat,
                    pooled_data.token_a_amount,
                    pooled_data.token_b_amount,
                  )
              }
            }
          let tag_check =
            tag
              |> option.map(
                   fn(oref) {
                     list.any(inputs, fn(in) { in.output_reference == oref })
                   },
                 )
              |> option.or_else(True)
          let token_name_oref_consumed_check =
            list.any(inputs, fn(in) { in.output_reference == pool_utxo })
          let datum_check = actual_datum_output == expected_collateral_datum

          let overcollateralized_check =
            finance.check_is_overcollaterized(
              loan_value,
              collateral_tokens_value,
              pool_config.initial_collateral_ratio,
            )
          let stake_check =
            pool_address.stake_credential == collateral_address.stake_credential
          let valid = and {
              collateral_amount_check?,
              collateral_at_script_check?,
              datum_check?,
              minted_amount_check?,
              overcollateralized_check?,
              pool_nft_check?,
              stake_check?,
              tag_check?,
              token_name_oref_consumed_check?,
              dust_attack_check?,
              valid_borrower_tn?,
              valid_validity_range?,
            }
          if valid {
            pruned_inputs |> list.tail
          } else {
            None
          }
        },
      )

    let burns_are_valid =
      list.foldl(
        burns,
        Some(dict.to_list(own_mints)),
        fn(
          collateral_burn: BurnNFTElem,
          curr_mints_opt: Option<List<(ByteArray, Int)>>,
        ) -> Option<List<(ByteArray, Int)>> {
          let BurnNFTElem(burn_coll_name) = collateral_burn
          expect Some(curr_mints) = curr_mints_opt
          let pruned_mints =
            curr_mints
              |> list.drop_while(
                   fn(burn) {
                     let (burn_tn, _) = burn
                     burn_coll_name != burn_tn
                   },
                 )
          expect [(_, -1)] = pruned_mints |> list.take(1)
          list.tail(pruned_mints)
        },
      )

    and {
      num_minted_check?,
      option.is_some(mints_are_valid)?,
      option.is_some(burns_are_valid)?,
    }
  }
}
