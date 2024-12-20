use aada/finance
use aada/nft.{CollateralNFTRedeemerLists, MintNFTElem}
use aada/types/pool
use aada/types/pool_stake
use aiken/cbor
use aiken/dict
use aiken/list
use aiken/math/rational
use aiken/transaction.{
  InlineDatum, Input, Mint, Output, Publish, ScriptContext, Spend, Transaction,
}
use aiken/transaction/certificate.{CredentialDelegation}
use aiken/transaction/credential.{Address, Inline, ScriptCredential}
use aiken/transaction/value.{
  PolicyId, flatten, from_asset, from_minted_value, merge, quantity_of, tokens,
  without_lovelace,
}

validator(delegator_nft_policy: PolicyId, pool_config_script_hash: PolicyId) {
  fn spend(datum: pool.Datum, redeemer: pool.Redeemer, ctx: ScriptContext) {
    let pool.Datum { params, balance, lent_out, total_lp_tokens } = datum
    let ScriptContext {
      transaction: Transaction {
        inputs,
        mint,
        redeemers,
        reference_inputs,
        outputs,
        ..
      },
      purpose,
    } = ctx
    let mint = from_minted_value(mint)
    expect Spend(output_ref) = purpose
    expect Some(Input {
      output: Output { address: this_address, value: pool_input_value, .. },
      ..
    }) =
      list.find(inputs, fn(inp) -> Bool { inp.output_reference == output_ref })
    expect ScriptCredential(this_script_hash) = this_address.payment_credential
    let pool_nft_policy: PolicyId = this_script_hash

    // Validates that pool receives right amount and correct datum is assigned
    // Validate if pool token is in transaction
    let pool.Redeemer { action, config_ref, .. } = redeemer
    expect Some(config_input) =
      list.find(
        reference_inputs,
        fn(inp) -> Bool { inp.output_reference == config_ref },
      )
    // Make sure pool config NFT is in the transaction
    let config_has_nft =
      quantity_of(
        config_input.output.value,
        pool_config_script_hash,
        params.pool_config_assetname,
      ) == 1

    expect InlineDatum(raw_config_input_datum) = config_input.output.datum
    expect pool.Config {
      pool_fee,
      min_transition,
      min_loan,
      min_fee,
      interest_params,
      ..
    }: pool.Config = raw_config_input_datum

    // Validated pool deposit/withdraw transition
    let validate_transition =
      fn(pool_output: pool.OutputIndex, f_delta: fn(Int, Int, Int) -> Bool) -> Bool {
        expect Some(pool_output) = outputs |> list.at(pool_output)
        expect InlineDatum(contract_datum) = pool_output.datum
        expect pool.Datum {
          params: output_params,
          balance: output_balance,
          lent_out: output_lent_out,
          total_lp_tokens: output_total_lp_tokens,
        }: pool.Datum = contract_datum
        let output_is_positive = output_lent_out >= 0 && output_balance >= 0
        let expected_change_value =
          from_asset(
            params.loan_cs.policy_id,
            params.loan_cs.asset_name,
            output_balance - balance,
          )
        let expected_value_with_input =
          merge(pool_input_value, expected_change_value)

        let dust_attack_check =
          without_lovelace(expected_value_with_input) == without_lovelace(
            pool_output.value,
          )

        let valid_pool_output_address = pool_output.address == this_address

        // Pool receives value it expects
        let value_change_check =
          quantity_of(
            expected_value_with_input,
            params.loan_cs.policy_id,
            params.loan_cs.asset_name,
          ) == quantity_of(
            pool_output.value,
            params.loan_cs.policy_id,
            params.loan_cs.asset_name,
          )
        // Pol NFT is present in both input and output
        let pool_input_nft_check =
          quantity_of(pool_input_value, pool_nft_policy, params.pool_nft_name) == 1

        let pool_output_nft_check =
          quantity_of(pool_output.value, pool_nft_policy, params.pool_nft_name) == 1

        let valid_pool_token_tx = pool_output_nft_check && pool_input_nft_check

        let params_check = output_params == params
        let f_delta_check =
          f_delta(
            output_balance - balance,
            output_lent_out - lent_out,
            output_total_lp_tokens - total_lp_tokens,
          )
        and {
          valid_pool_token_tx?,
          value_change_check?,
          f_delta_check?,
          params_check?,
          output_is_positive?,
          dust_attack_check?,
          valid_pool_output_address?,
        }
      }
    when action is {
      pool.Destroy -> {
        // Can only destroy if all LP tokens are burned
        let lp_token_delta =
          quantity_of(
            mint,
            params.lp_token.policy_id,
            params.lp_token.asset_name,
          )
        let no_remaining_liquidity_tokens =
          lp_token_delta + total_lp_tokens == 0

        // Only one pool mint transaction when destroying
        expect Some(mint_redeemer) =
          redeemers
            |> dict.get(Mint(pool_nft_policy))

        expect mint_redeemer: pool.PoolNFTAction = mint_redeemer
        expect pool.BurnPoolNFT(burn_tn) = mint_redeemer
        let burned_token_name_match = burn_tn == params.pool_nft_name
        let burnt_delegator_nft =
          quantity_of(mint, delegator_nft_policy, params.pool_config_assetname) == -1
        and {
          no_remaining_liquidity_tokens?,
          burnt_delegator_nft?,
          config_has_nft?,
          burned_token_name_match?,
        }
      }
      pool.Continuing(continuing_action) ->
        when continuing_action is {
          pool.LpAdjust { value_delta, continuing_output } -> {
            let lp_token_delta =
              quantity_of(
                mint,
                params.lp_token.policy_id,
                params.lp_token.asset_name,
              )

            expect Some(owned_proportion) =
              lp_token_delta * ( balance + lent_out )
                |> rational.new(total_lp_tokens)

            let sign_check = or {
                // Withdraw scenario
                and {
                  value_delta < 0,
                  lp_token_delta < 0,
                  value_delta * -1 >= min_transition,
                  lp_token_delta * -1 < total_lp_tokens,
                },
                // ensure not withdrawing more than existing supply
                // Deposit scenario
                and {
                  value_delta > 0,
                  lp_token_delta > 0,
                  value_delta >= min_transition,
                },
              }

            let notzero =
              rational.compare(owned_proportion, rational.from_int(0)) != Equal

            // When withdrawing owned_proportion means max you can withdraw.
            // When depositing owned_proportion means min you can deposit.
            trace cbor.diagnostic(rational.truncate(owned_proportion))
            trace cbor.diagnostic(value_delta)

            let check_delta_amount =
              if value_delta < 0 {
                value_delta * -1 <= rational.truncate(owned_proportion) * -1
              } else {
                value_delta >= rational.truncate(owned_proportion)
              }

            let value_delta_check = and {
                sign_check,
                notzero,
              }
            let transition_validator =
              fn(balance_delta, lent_delta, tokens_delta) { and {
                  balance_delta == pool_fee + value_delta,
                  lent_delta == 0,
                  tokens_delta == lp_token_delta,
                } }
            let valid_transition =
              continuing_output
                |> validate_transition(transition_validator)

            and {
              check_delta_amount?,
              valid_transition?,
              value_delta_check?,
              config_has_nft?,
            }
          }
          pool.Borrow { loan_amount, interest_rate, continuing_output, .. } -> {
            let loan_is_positive = loan_amount > 0
            let passes_min_threshold = loan_amount >= min_loan
            let interest_rate_is_positive = interest_rate > 0
            let transition_validator =
              fn(balance_delta, lent_delta, tokens_delta) {
                pool_fee - loan_amount == balance_delta && loan_amount == lent_delta && tokens_delta == 0
              }
            let valid_transition =
              continuing_output
                |> validate_transition(transition_validator)
            let valid_interest_rates =
              interest_rate >= finance.get_interest_rates(
                interest_params,
                loan_amount,
                lent_out,
                balance,
              )

            expect ScriptCredential(collateral_policy) =
              params.collateral_address.payment_credential
            expect Some(collateral_mint_redeemer) =
              redeemers |> dict.get(Mint(collateral_policy))
            expect collateral_mint_redeemer: CollateralNFTRedeemerLists =
              collateral_mint_redeemer

            let valid_collateral_exists =
              collateral_mint_redeemer.mints
                |> list.any(
                     fn(el) {
                       let MintNFTElem(pool_utxo, _) = el
                       pool_utxo == output_ref
                     },
                   )
            and {
              loan_is_positive?,
              interest_rate_is_positive?,
              passes_min_threshold?,
              valid_collateral_exists?,
              valid_transition?,
              valid_interest_rates?,
              config_has_nft?,
            }
          }
          pool.CloseLoan { loan_amount, repay_amount, continuing_output } -> {
            let loan_amt_check = loan_amount > 0
            let repay_amt_check = repay_amount > loan_amount
            let transition_validator =
              fn(balance_delta, lent_delta, tokens_delta) { and {
                  balance_delta == pool_fee + repay_amount,
                  lent_delta == -loan_amount,
                  tokens_delta == 0,
                } }
            let valid_transition =
              continuing_output
                |> validate_transition(transition_validator)
            and {
              loan_amt_check?,
              repay_amt_check?,
              valid_transition?,
              config_has_nft?,
            }
          }
          pool.PayFee { fee, continuing_output } -> {
            let valid_minimum_amount = fee > min_fee
            let transition_validator =
              fn(balance_delta, lent_value_delta, tokens_mint_delta) { and {
                  balance_delta == fee,
                  lent_value_delta == 0,
                  tokens_mint_delta == 0,
                } }
            let valid_transition =
              continuing_output
                |> validate_transition(transition_validator)
            and {
              valid_minimum_amount?,
              valid_transition?,
              config_has_nft?,
            }
          }
        }
    }
  }

  fn mint(redeemer: pool.PoolNFTAction, ctx: ScriptContext) -> Bool {
    let ScriptContext {
      transaction: Transaction { outputs, mint, redeemers, .. },
      purpose,
    } = ctx

    expect Mint(own_script) = purpose
    let pool_control_credential = ScriptCredential(own_script)
    let mint = from_minted_value(mint)

    when redeemer is {
      pool.MintPoolNFT(pool_mint_details) -> {
        let pool_mint_details: pool.PoolCreateDetails = pool_mint_details
        let pool_output =
          outputs
            |> list.at(pool_mint_details.output_index)
        expect Some(Output {
          address: Address(out_credential, Some(out_stake_credential)),
          value,
          ..
        }) = pool_output
        expect Inline(stake_cred) = out_stake_credential
        expect ScriptCredential(stake_hash) = stake_cred

        expect Some(stake_validator_redeemer) =
          dict.get(
            redeemers,
            Publish(
              CredentialDelegation(
                out_stake_credential,
                pool_mint_details.initial_pool_delegation,
              ),
            ),
          )
        expect withdraw_validator_redeemer: pool_stake.StakeRedeemer =
          stake_validator_redeemer

        expect pool_stake.CreatePool(_withdraw_validator_oref) =
          withdraw_validator_redeemer
        let correct_credential = out_credential == pool_control_credential
        // Pool NFT name is stake_hash
        let correct_quantity_output =
          quantity_of(value, own_script, stake_hash) == 1

        expect [(_stake_hash, 1)] = tokens(mint, own_script) |> dict.to_list

        let no_dust_attack =
          when flatten(value) is {
            [(_, _, _)] -> True
            [(_, _, _), (_, _, _)] -> True
            [(_, _, _), (_, _, _), (_, _, _)] -> True
            _ -> False
          }
        and {
          correct_credential,
          correct_quantity_output,
          no_dust_attack,
        }
      }

      // Pool NFT is locked in Pool Validator. You can't easily burn it.
      // Should expect only one policy mint and it's -1
      pool.BurnPoolNFT(burn_tn) -> {
        expect [(burnt_nft_name, -1)] =
          dict.to_list(value.tokens(mint, own_script))
        burn_tn == burnt_nft_name
      }
    }
  }
}
