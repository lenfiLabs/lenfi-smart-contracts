use aada/finance
use aada/types/pool
use aiken/math/rational
use aiken/option

/// Interest rates tests
test test_interest_amount() {
  let interest_rate = 400000
  let loan_amount = 100000000
  let current_ts = 1681098024000
  let loan_start_ts = 1680925224000
  (
    finance.calculate_interest_amount(
      interest_rate,
      loan_amount,
      loan_start_ts,
      current_ts,
    )
      |> option.map(rational.truncate)
  ) == Some(219178)
}

test test_interest_longer_period() {
  let interest_rate = 200000
  let loan_amount = 50000000
  let current_ts = 1682098024000
  let loan_start_ts = 1680925224000
  (
    finance.calculate_interest_amount(
      interest_rate,
      loan_amount,
      loan_start_ts,
      current_ts,
    )
      |> option.map(rational.truncate)
  ) == Some(371892)
}

test test_interest_high_rate() {
  let interest_rate = 800000
  let loan_amount = 100000000
  let current_ts = 1681098024000
  let loan_start_ts = 1680925224000
  (
    finance.calculate_interest_amount(
      interest_rate,
      loan_amount,
      loan_start_ts,
      current_ts,
    )
      |> option.map(rational.truncate)
  ) == Some(438356)
}

test test_interest_large_loan() {
  let interest_rate = 400000
  let loan_amount = 500000000
  let current_ts = 1681098024000
  let loan_start_ts = 1680925224000
  (
    finance.calculate_interest_amount(
      interest_rate,
      loan_amount,
      loan_start_ts,
      current_ts,
    )
      |> option.map(rational.truncate)
  ) == Some(1095890)
}

test test_interest_negative_rate() {
  let interest_rate = -400000
  let loan_amount = 100000000
  let current_ts = 1681098024000
  let loan_start_ts = 1680925224000
  (
    finance.calculate_interest_amount(
      interest_rate,
      loan_amount,
      loan_start_ts,
      current_ts,
    )
      |> option.map(rational.truncate)
  ) == Some(-219178)
}

test health_factor_1() {
  let liquidation_threshold = 1600000
  let collateral_value = 1300000
  let value_in_debt = 1000000

  expect Some(hf) =
    finance.calculate_health_factor(
      liquidation_threshold,
      collateral_value,
      value_in_debt,
    )

  let hf =
    hf
      |> rational.truncate()
  hf == 812500
}

test health_factor_2() {
  let liquidation_threshold = 2000000
  let collateral_value = 1_000_000_000
  let value_in_debt = 500_000_000

  expect Some(hf) =
    finance.calculate_health_factor(
      liquidation_threshold,
      collateral_value,
      value_in_debt,
    )

  let hf =
    hf
      |> rational.truncate()
  hf == 1000000
}

// Need to validate first.
test interest_rate_1() {
  let loan_amount = 100000000
  let lent_out = 11118000000
  let balance = 65040765216

  let pool_params: pool.InterestParams =
    pool.InterestParams {
      optimal_utilization: 450000,
      base_interest_rate: 30000,
      rslope1: 75000,
      rslope2: 300000,
    }

  // Utilization rate of 14%
  let interest_rate =
    finance.get_interest_rates(pool_params, loan_amount, lent_out, balance)

  interest_rate == 41047
}

test interest_rate_2() {
  let loan_amount = 100_000_000
  let lent_out = 0
  let balance = 4_000_000_000

  let pool_params: pool.InterestParams =
    pool.InterestParams {
      optimal_utilization: 450_000,
      base_interest_rate: 30_000,
      rslope1: 75_000,
      rslope2: 300_000,
    }

  let interest_rate =
    finance.get_interest_rates(pool_params, loan_amount, lent_out, balance)

  interest_rate == 31875
}

test interest_rate_3() {
  // UT: 2.5%
  let loan_amount = 100_000_000
  let lent_out = 0
  let balance = 4_000_000_000

  let pool_params: pool.InterestParams =
    pool.InterestParams {
      optimal_utilization: 450_000,
      base_interest_rate: 30_000,
      rslope1: 75_000,
      rslope2: 300_000,
    }

  let interest_rate =
    finance.get_interest_rates(pool_params, loan_amount, lent_out, balance)

  interest_rate == 31875
}

test interest_rate_4() {
  // UT: 75%
  let loan_amount = 3_000_000_000
  let lent_out = 0
  let balance = 4_000_000_000

  let pool_params: pool.InterestParams =
    pool.InterestParams {
      optimal_utilization: 450_000,
      base_interest_rate: 30_000,
      rslope1: 75_000,
      rslope2: 300_000,
    }

  let interest_rate =
    finance.get_interest_rates(pool_params, loan_amount, lent_out, balance)

  interest_rate == 153750
}

test interest_rate_5() {
  // UT: 48.12333%
  let loan_amount = 1_924_933_200
  let lent_out = 0
  let balance = 4_000_000_000

  let pool_params: pool.InterestParams =
    pool.InterestParams {
      optimal_utilization: 450_000,
      base_interest_rate: 30_000,
      rslope1: 75_000,
      rslope2: 300_000,
    }

  let interest_rate =
    finance.get_interest_rates(pool_params, loan_amount, lent_out, balance)

  interest_rate == 73119
}

// Selling LENFI for ADA
test check_lenfi_sale() {
  let sell_amount = 1000000000
  // SELLING THIS AMOUNT OF LENFI
  let lenfi_in_pool = 434698523921
  let ada_in_pool = 3168139297676
  let result =
    finance.token_b_received_from_seling_token_a(
      rational.from_int(sell_amount),
      lenfi_in_pool,
      ada_in_pool,
    )
  result == 7249638121
  // https://prnt.sc/GUlrkN0uTQ3q
}

// Selling ADA for LENFI
test check_ada_sale_for_lenfi() {
  let sell_amount = 50000000
  // SELLING THIS AMOUNT OF ADA
  let lenfi_in_pool = 434698523921
  let ada_in_pool = 3168139297676
  let result =
    finance.token_b_received_from_seling_token_a(
      rational.from_int(sell_amount),
      ada_in_pool,
      lenfi_in_pool,
    )
  result == 136754745
  // https://prnt.sc/uLsyxqn6GkcA
}

// BUYNG LENFI WITH ADA
test token_b_needed_to_purchase_token_a() {
  let buy_amount = 1000000000
  // Buying this amount of LENFI
  // Want to buy this amount of LENFI
  let lenfi_in_pool = 435169426396
  let ada_in_pool = 3164135184992
  let result =
    finance.token_b_needed_to_purchase_token_a(
      rational.from_int(buy_amount),
      ada_in_pool,
      lenfi_in_pool,
    )
  result == 137989316
  // https://prnt.sc/XHSQdh2ecQmv
}

// BUING ADA WITH LENFI
test token_b_needed_to_purchase_token_a_2() {
  let buy_amount = 1000000000
  // Buying this amount of ADA
  let lenfi_in_pool = 435169426396
  let ada_in_pool = 3164135184992

  let result =
    finance.token_b_needed_to_purchase_token_a(
      rational.from_int(buy_amount),
      lenfi_in_pool,
      ada_in_pool,
    )
  result == 7309718189
  // https://prnt.sc/GgMrE5jlj-TO
}

test asset_gain_ada_sale_test() {
  let sell_amount = 1000000000
  // Buying this amount of ADA
  let lenfi_in_pool = 435169426396
  let ada_in_pool = 3164135184992
  finance.retired_asset_gain_adasale(sell_amount, lenfi_in_pool, ada_in_pool) == 7232658426
}



test asset_gain_function_matching_test() {
  let sell_amount = 1000000000
  // Buying this amount of ADA
  let lenfi_in_pool = 435169426396
  let ada_in_pool = 3164135184992
  finance.retired_asset_gain_adasale(sell_amount, lenfi_in_pool, ada_in_pool) == finance.token_b_received_from_seling_token_a(
    rational.from_int(sell_amount),
    lenfi_in_pool,
    ada_in_pool,
  )
}

test check_is_undercollaterized() {
  let value_in_debt = 2000000
  let collateral_value = 2000000
  let liquidation_threshold = 1000000
  let result =
    finance.check_is_undercollaterized(
      value_in_debt,
      collateral_value,
      liquidation_threshold,
    )
  result == False
}

test check_is_undercollaterized_2() {
  let value_in_debt = 2000001
  let collateral_value = 2000000
  let liquidation_threshold = 1000000
  let result =
    finance.check_is_undercollaterized(
      value_in_debt,
      collateral_value,
      liquidation_threshold,
    )
  result == True
}

test check_is_undercollaterized_3() {
  let value_in_debt = 20000000
  let collateral_value = 34000000
  let liquidation_threshold = 1700000
  let result =
    finance.check_is_undercollaterized(
      value_in_debt,
      collateral_value,
      liquidation_threshold,
    )
  result == False
}

test check_is_overcollaterized() {
  let value_in_debt = 6046051482
  let collateral_value = value_in_debt * 2 + 1
  let liquidation_threshold = 2000000

  let result =
    finance.check_is_overcollaterized(
      value_in_debt,
      collateral_value,
      liquidation_threshold,
    )
  result == True
}

test check_is_overcollaterized_2() {
  let value_in_debt = 6046051482
  let collateral_value = value_in_debt * 2
  let liquidation_threshold = 2000000

  let result =
    finance.check_is_overcollaterized(
      value_in_debt,
      collateral_value,
      liquidation_threshold,
    )
  result == False
}

test deposit_amount_check() {
  let lp_token_delta = 122999989
  let balance = 262000022
  let lent_out = 1000000
  let total_lp_tokens = 263000000

  expect Some(owned_proportion) =
    lp_token_delta * ( balance + lent_out )
      |> rational.new(total_lp_tokens)

  let owned_proportion_int = rational.truncate(owned_proportion)
  owned_proportion_int == 123
}
