use aada/types/pool
use aada/utils
use aiken/math/rational.{Rational}
use aiken/option

/// Calculate interest amount 
pub fn calculate_interest_amount(
  interest_rate: Int,
  loan_amount: Int,
  loan_start_ts: Int,
  current_ts: Int,
) -> Option<Rational> {
  loan_amount * interest_rate * ( current_ts - loan_start_ts )
    |> rational.new(31536000000 * 1000000)
}

/// Get amount of expected deposit when LP tokens are present
pub fn get_expected_deposit_amount(
  lp_tokens_amount: Int,
  balance: Int,
  lent_out: Int,
  total_lp_tokens: Int,
) -> Option<Rational> {
  lp_tokens_amount * ( balance + lent_out )
    |> rational.new(total_lp_tokens)
}

/// Retired. Keeping it now to prove the tests
pub fn retired_calculate_sale(
  sell_amount: Rational,
  token_2_amount: Int,
  token_1_amount: Int,
) -> Int {
  expect Some(result) =
    sell_amount
      |> rational.mul(997 * token_1_amount |> rational.from_int)
      |> utils.safe_div(
           token_2_amount * 1000
             |> rational.from_int
             |> rational.add(997 |> rational.from_int |> rational.mul(sell_amount)),
         )
  rational.truncate(result)
}

pub fn token_b_received_from_seling_token_a(
  sell_amount: Rational,
  token_a_amount: Int,
  token_b_amount: Int,
) -> Int {
  let sell_amount_int = sell_amount |> rational.truncate()

  let nominator = sell_amount_int * 997 * token_b_amount
  let denominator = token_a_amount * 1000 + 997 * sell_amount_int
  let asset_return = nominator / denominator
  asset_return
}

/// Calculate the return from selling tokens
/// Retired. Keeping it now to prove the tests
pub fn retired_ada_for_purchase(
  buy_amount: Rational,
  token_2_amount: Int,
  token_1_amount: Int,
) -> Int {
  expect Some(result) =
    buy_amount
      |> rational.mul(1000 * token_1_amount |> rational.from_int)
      |> utils.safe_div(
           token_2_amount
             |> rational.from_int
             |> rational.sub(buy_amount)
             |> rational.mul(997 |> rational.from_int),
         )

  rational.truncate(result)
}

/// Calculate the ada required to purchase tokens
pub fn token_b_needed_to_purchase_token_a(
  buy_amount: Rational,
  token_a_amount: Int,
  token_b_amount: Int,
) -> Int {
  let buy_amount_int = buy_amount |> rational.truncate()

  let nominator = buy_amount_int * 1000 * token_b_amount
  let denominator = ( token_a_amount - buy_amount_int ) * 997
  let ada_required = nominator / denominator
  ada_required
}

/// Calculate the ada required to purchase tokens
/// Retired. Keeping it now to prove the tests
pub fn retired_asset_gain_adasale(
  ada_sell_amount: Int,
  token_1_amount: Int,
  token_2_amount: Int,
) -> Int {
  let ada_sell_amount_with_fee = ada_sell_amount * 997
  let new_token_1_amount = token_1_amount * 1000 + ada_sell_amount_with_fee
  let numerator = ada_sell_amount_with_fee * token_2_amount
  let denominator = new_token_1_amount
  expect Some(result) = rational.new(numerator, denominator)
  result |> rational.truncate()
}

/// Calculate health from debt,collat,threshold
pub fn calculate_health_factor(
  debt: Int,
  collateral: Int,
  threshold: Int,
) -> Option<Rational> {
  expect Some(hf) =
    collateral * 1000000000000
      |> rational.new(threshold * debt)

  Some(hf)
}

pub fn check_is_overcollaterized(
  value_in_debt: Int,
  collateral_value: Int,
  liquidation_threshold: Int,
) -> Bool {
  // Check if loan is overcollaterized. Meaning 'value' in debt is large enought compared to collateral factor.
  let over_collateralized: Bool =
    when
      calculate_health_factor(
        value_in_debt,
        collateral_value,
        liquidation_threshold,
      )
    is {
      Some(rat) -> Some(rational.compare(rat, 1000000 |> rational.from_int))
      None -> None
    } == Some(Greater)
  over_collateralized
}

/// Health factor < 100%
pub fn check_is_undercollaterized(
  value_in_debt: Int,
  collateral_value: Int,
  liquidation_threshold: Int,
) {
  let under_collateralized: Bool =
    (
      calculate_health_factor(
        value_in_debt,
        collateral_value,
        liquidation_threshold,
      )
        |> option.map(rational.compare(_, 1000000 |> rational.from_int))
    ) == Some(Less)
  under_collateralized
}

/// Calculate interest rates for a loan
pub fn get_interest_rates(
  interest_params: pool.InterestParams,
  loan_amount: Int,
  lent_out: Int,
  balance: Int,
) -> Int {
  // These are parameters hardcoded into contract. It can be moved to referencable UTXO 
  // in order to be updatable, but with the same validator hash
  let optimal_utilization = interest_params.optimal_utilization
  let base_interest_rate = interest_params.base_interest_rate * 1_000_000
  let rslope1 = interest_params.rslope1
  let rslope2 = interest_params.rslope2

  let utilization_rate =
    ( lent_out + loan_amount ) * 1000000 / ( balance + lent_out )

  if utilization_rate < optimal_utilization {
    let utilization_charge = utilization_rate * rslope1

    ( utilization_charge + base_interest_rate ) / 1000000
  } else {
    let lowly_charged_value = rslope1 * optimal_utilization
    let highly_charged_value =
      ( utilization_rate - optimal_utilization ) * rslope2

    ( base_interest_rate + lowly_charged_value + highly_charged_value ) / 1000000
  }
}
