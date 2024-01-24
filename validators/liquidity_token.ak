use aada/types/pool
use aiken/dict
use aiken/list
use aiken/transaction.{InlineDatum, Mint, OutputReference, ScriptContext}
use aiken/transaction/value.{flatten, from_minted_value, quantity_of, tokens}

type TokenRedeemer {
  TransitionPool {
    pool_oref: OutputReference,
    continuing_output: pool.OutputIndex,
  }
  CreatePool { produced_output: pool.OutputIndex }
  DestroyPool { pool_oref: OutputReference }
}

validator(pool_hash: ByteArray, token_name: ByteArray) {
  fn liquidity_token(redeemer: TokenRedeemer, ctx: ScriptContext) {
    expect Mint(own_policy) = ctx.purpose
    when redeemer is {
      TransitionPool { pool_oref, continuing_output } -> {
        expect Some(pool_input) =
          ctx.transaction.inputs
            |> list.find(fn(inp) { inp.output_reference == pool_oref })
        expect Some(pool_output) =
          ctx.transaction.outputs |> list.at(continuing_output)
        expect InlineDatum(input_datum) = pool_input.output.datum
        expect input_datum: pool.Datum = input_datum
        expect InlineDatum(output_datum) = pool_output.datum
        expect output_datum: pool.Datum = output_datum
        let pool_addresses_matches =
          pool_input.output.address == pool_output.address
        let id = input_datum.params.pool_nft_name

        let dust_attack_check =
          when flatten(pool_input.output.value) is {
            [(_, _, _)] -> False
            [(_, _, _), (_, _, _)] -> True
            [(_, _, _), (_, _, _), (_, _, _)] -> True
            _ -> False
          }
        let nfts_check =
          quantity_of(pool_input.output.value, pool_hash, id) == 1 && quantity_of(
            pool_output.value,
            pool_hash,
            id,
          ) == 1

        expect [(lp_token_name, lp_tokens_amount)] =
          tokens(from_minted_value(ctx.transaction.mint), own_policy)
            |> dict.to_list()

        let valid_lp_token_name =
          lp_token_name == output_datum.params.pool_nft_name
        let valid_lp_token_change =
          output_datum.total_lp_tokens - input_datum.total_lp_tokens == lp_tokens_amount
        and {
          valid_lp_token_change,
          valid_lp_token_name,
          nfts_check,
          dust_attack_check,
          pool_addresses_matches,
        }
      }
      DestroyPool { pool_oref } -> {
        expect Some(pool_input) =
          ctx.transaction.inputs
            |> list.find(fn(inp) { inp.output_reference == pool_oref })
        expect InlineDatum(input_datum) = pool_input.output.datum
        expect input_datum: pool.Datum = input_datum

        let nfts_check =
          quantity_of(pool_input.output.value, pool_hash, token_name) == 1
        let nft_name_datum_check =
          input_datum.params.pool_nft_name == token_name

        let actual_tokens_minted =
          quantity_of(
            from_minted_value(ctx.transaction.mint),
            own_policy,
            token_name,
          )

        let tokens_mint_check =
          actual_tokens_minted + input_datum.total_lp_tokens == 0

        and {
          tokens_mint_check,
          nfts_check,
          nft_name_datum_check,
        }
      }
      CreatePool { produced_output } -> {
        expect Some(pool_output) =
          ctx.transaction.outputs |> list.at(produced_output)
        expect InlineDatum(output_datum) = pool_output.datum
        expect output_datum: pool.Datum = output_datum
        let mint = from_minted_value(ctx.transaction.mint)

        // Expects only one tokenName to be minted
        expect [(pool_token_name, 1)] = dict.to_list(tokens(mint, pool_hash))

        // Doing an extra check for all the name matching
        let correct_pooltoken_name = and {
            pool_token_name == output_datum.params.pool_nft_name,
            token_name == pool_token_name,
          }

        let lp_tokens_minted = quantity_of(mint, own_policy, pool_token_name)
        let depositing_tokens_count_actual =
          quantity_of(
            pool_output.value,
            output_datum.params.loan_cs.policy_id,
            output_datum.params.loan_cs.asset_name,
          )
        // Can it be redundant? Pool.ak has valid_pool_output()
        let correct_pooltoken_out =
          quantity_of(pool_output.value, pool_hash, pool_token_name) == 1

        let correct_recorded_lptokens =
          output_datum.total_lp_tokens == lp_tokens_minted
        let depositing_gt_0 = depositing_tokens_count_actual > 0
        let depositing_at_script =
          depositing_tokens_count_actual == output_datum.balance
        let minted_lp_match_deposit =
          depositing_tokens_count_actual == lp_tokens_minted
        and {
          correct_pooltoken_out,
          correct_recorded_lptokens,
          depositing_gt_0,
          depositing_at_script,
          minted_lp_match_deposit,
          correct_pooltoken_name,
        }
      }
    }
  }
}
