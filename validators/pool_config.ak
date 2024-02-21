use aada/nft.{NFTRedeemerElement, check_uniqueness}
use aada/nft_pointers
use aada/types.{AssetClass}
use aada/types/pool
use aiken/dict
use aiken/list
use aiken/transaction.{
  InlineDatum, Input, Mint, Output, ScriptContext, Spend, Transaction,
}
use aiken/transaction/credential.{ScriptCredential}
use aiken/transaction/value.{PolicyId, quantity_of, tokens}

type ConfigRedeemer {
  pool_config_output_index: pool.OutputIndex,
  fee_collector_output_index: pool.OutputIndex,
}

validator(gov_nft: AssetClass) {
  fn spend(datum: pool.Config, redeemer: ConfigRedeemer, ctx: ScriptContext) {
    let AssetClass { policy_id, asset_name } = gov_nft
    let ScriptContext {
      transaction: Transaction {
        reference_inputs,
        withdrawals,
        extra_signatories,
        inputs,
        outputs,
        ..
      },
      purpose,
    } = ctx
    expect Spend(output_ref) = purpose
    expect Some(Input {
      output: Output { address: this_address, value: config_input_value, .. },
      ..
    }) =
      list.find(inputs, fn(inp) -> Bool { inp.output_reference == output_ref })
    expect ScriptCredential(this_script_hash) = this_address.payment_credential
    let config_nft_policy: PolicyId = this_script_hash

    // Find config output
    expect Some(config_output) =
      outputs |> list.at(redeemer.pool_config_output_index)
    let valid_config_output_address = config_output.address == this_address

    // Expect only one pool config NFT in the output.
    expect [(pool_config_name, 1)] =
      tokens(config_input_value, config_nft_policy)
        |> dict.to_list()
    let config_output_nft_check =
      quantity_of(config_output.value, config_nft_policy, pool_config_name) == 1

    expect InlineDatum(config_ouput_datum) = config_output.datum
    expect pool.Config {
      liquidation_threshold,
      initial_collateral_ratio,
      pool_fee,
      loan_fee_details,
      min_transition,
      min_loan,
      min_fee,
      merge_action_fee,
      interest_params,
      min_liquidation_fee,
    }: pool.Config = config_ouput_datum

    // Make sure fees are not negative
    let fees_are_not_negative = and {
        pool_fee >= 0,
        loan_fee_details.tier_1_fee >= 0,
        loan_fee_details.tier_2_fee >= 0,
        loan_fee_details.tier_3_fee >= 0,
        loan_fee_details.liquidation_fee >= 0,
        loan_fee_details.tier_1_threshold >= 0,
        loan_fee_details.tier_2_threshold > loan_fee_details.tier_1_threshold,
        loan_fee_details.tier_3_threshold > loan_fee_details.tier_2_threshold,
        merge_action_fee >= 0,
        min_liquidation_fee > 0,
      }

    // Make sure min values are not negative 
    let min_values_are_not_negative = and {
        min_transition >= 0,
        min_loan >= 0,
      }

    let valid_min_fee = min_fee >= pool_fee

    // Make sure fee receiver is valid address by checking if address has at least one output
    let valid_merge_action_fee = merge_action_fee > pool_fee
    expect Some(fee_collector_ouput) =
      outputs |> list.at(redeemer.fee_collector_output_index)
    let valid_fee_collector_address =
      fee_collector_ouput.address == loan_fee_details.platform_fee_collector_address

    // Make sure LT and ICR are not changed
    let liquidations_params_are_not_changed = and {
        liquidation_threshold == datum.liquidation_threshold,
        initial_collateral_ratio == datum.initial_collateral_ratio,
      }

    // Interest params validation
    let valid_interest_params = and {
        interest_params.optimal_utilization >= 0,
        interest_params.base_interest_rate >= 0,
        interest_params.rslope2 > interest_params.rslope1,
      }

    let gov_approval =
      nft_pointers.nft_validator(
        policy_id,
        asset_name,
        reference_inputs,
        withdrawals,
        extra_signatories,
      )
    and {
      gov_approval?,
      fees_are_not_negative?,
      liquidations_params_are_not_changed?,
      valid_fee_collector_address?,
      config_output_nft_check?,
      valid_config_output_address?,
      min_values_are_not_negative?,
      valid_min_fee?,
      valid_merge_action_fee?,
      valid_interest_params?,
    }
  }

  fn mint(r: NFTRedeemerElement<Void>, ctx: ScriptContext) -> Bool {
    let ScriptContext { transaction, purpose } = ctx
    when purpose is {
      Mint(this_policy) -> {
        let Transaction { inputs, mint, .. } = transaction
        let NFTRedeemerElement { action, .. } = r
        // Offchain validates if this NFT is sent to current pool. 
        check_uniqueness(action, inputs, mint, this_policy)
      }
      _ -> False
    }
  }
}
