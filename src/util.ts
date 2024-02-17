import {
  Unit,
  Data,
  fromHex,
  PolicyId,
  toHex,
  toUnit,
  Translucent,
  UTxO,
  Validator,
} from "translucent-cardano";
import { promises as fs } from "fs";
import { C } from "lucid-cardano";

import {
  Asset,
  LoanDetails,
  LpTokenCalculation,
  TokenData,
  ValidityRange,
} from "./types.ts";
import {
  CollateralSpend,
  DelayedMergeSpend,
  LeftoversLeftovers,
  LiquidityTokenLiquidityToken,
  OracleValidatorWithdrawValidate,
  OrderContractBorrowOrderContract,
  OrderContractDepositOrderContract,
  OrderContractRepayOrderContract,
  OrderContractWithdrawOrderContract,
  PlaceholderNftPlaceholderNft,
  PoolConfigMint,
  PoolConfigSpend,
  PoolSpend,
} from "./../plutus.ts";
import BigNumber from "bignumber.js";
import { TxHash } from "translucent-cardano";
import { PoolStakePoolStake } from "./../plutus.ts";

export type OutputReference = {
  transactionId: { hash: string };
  outputIndex: bigint;
};

const publicApiHost = "http://192.168.215.3:5000/public-api";
const queryAPI = "https://aada-v2-api-stag.aada.finance/api/v0.1";
const BLOCKFROST_API_KEY = "preprodDGwWUDsZ4nxxBl3MizYhipL0Wjb57HW0"; // Please replace 'your_api_key' with your actual Blockfrost API key

export const MIN_ADA = 2n * 1_000_000n;

export function utxoToOref(utxo: UTxO): OutputReference {
  return {
    transactionId: { hash: utxo.txHash },
    outputIndex: BigInt(utxo.outputIndex),
  };
}

export function calculateLpTokens(
  initialCount: bigint,
  alreadyLend: bigint,
  balanceToDeposit: bigint,
  totalLpTokens: bigint
): LpTokenCalculation {
  const initialCountBN = new BigNumber(Number(initialCount));
  const alreadyLendBN = new BigNumber(Number(alreadyLend));
  const balanceToDepositBN = new BigNumber(Number(balanceToDeposit));
  const totalLPTokensBN = new BigNumber(Number(totalLpTokens));

  const lpTokensToDeposit = balanceToDepositBN
    .multipliedBy(totalLPTokensBN)
    .div(initialCountBN.plus(alreadyLendBN));

  const whatValidatorWillExpect = lpTokensToDeposit
    .multipliedBy(initialCountBN.plus(alreadyLendBN))
    .div(totalLPTokensBN);

  return {
    depositAmount: BigInt(Math.floor(whatValidatorWillExpect.toNumber())),
    lpTokenMintAmount: BigInt(Math.floor(lpTokensToDeposit.toNumber())),
  };
}

export function calculateBalanceToDeposit(
  initialCount: bigint,
  alreadyLend: bigint,
  lpTokensToDeposit: bigint,
  totalLpTokens: bigint
): LpTokenCalculation {
  const initialCountBN = new BigNumber(Number(initialCount));
  const alreadyLendBN = new BigNumber(Number(alreadyLend));
  const lpTokensToDepositBN = new BigNumber(Number(lpTokensToDeposit));
  const totalLPTokensBN = new BigNumber(Number(totalLpTokens));

  // Calculating balanceToDeposit
  const balanceToDeposit = lpTokensToDepositBN
    .multipliedBy(initialCountBN.plus(alreadyLendBN))
    .div(totalLPTokensBN);

  return {
    depositAmount: BigInt(Math.floor(balanceToDeposit.toNumber())),
    lpTokenMintAmount: BigInt(Math.floor(lpTokensToDepositBN.toNumber())),
  };
}

export function findAssetQuantity(
  data: UTxO[],
  assetPolicy: string,
  assetName: string
): bigint {
  if (assetPolicy == "") {
    let assetQuantity = 0n;

    data.forEach((item) => {
      if (Object.prototype.hasOwnProperty.call(item.assets, "lovelace")) {
        assetQuantity += item.assets["lovelace"];
      }
    });

    return assetQuantity;
  } else {
    let assetQuantity = 0n;
    const assetKey = toUnit(assetPolicy, assetName);
    data.forEach((item) => {
      if (Object.prototype.hasOwnProperty.call(item.assets, assetKey)) {
        assetQuantity += item.assets[assetKey];
      }
    });

    return assetQuantity;
  }
}

type InterestParams = {
  optimalUtilization: bigint;
  baseInterestRate: bigint;
  rslope1: bigint;
  rslope2: bigint;
};

export function getInterestRates(
  interestParams: InterestParams,
  loanAmount: bigint,
  lentOut: bigint,
  balance: bigint
): bigint {
  // These are parameters hardcoded into contract. It can be moved to referencable UTXO
  // in order to be updatable, but with the same validator hash
  const optimalUtilizationBN = new BigNumber(
    Number(interestParams.optimalUtilization)
  );
  const baseInterestRateBN = new BigNumber(
    Number(interestParams.baseInterestRate * 1000000n)
  );
  const rslope1BN = new BigNumber(Number(interestParams.rslope1));
  const rslope2BN = new BigNumber(Number(interestParams.rslope2));
  const oneMillionBN = new BigNumber(1000000);
  const loanAmountBN = new BigNumber(Number(loanAmount));
  const lentOutBN = new BigNumber(Number(lentOut));
  const balanceBN = new BigNumber(Number(balance));

  const utilizationRateBN = new BigNumber(
    lentOutBN
      .plus(loanAmountBN)
      .multipliedBy(oneMillionBN)
      .dividedBy(balanceBN.plus(lentOutBN))
  );

  if (utilizationRateBN.lte(optimalUtilizationBN)) {
    const utilizationCharge = utilizationRateBN.multipliedBy(rslope1BN);
    // Base interest rate + charge for utilied loan
    return BigInt(
      Math.floor(
        baseInterestRateBN.plus(utilizationCharge).dividedBy(1000000).toNumber()
      )
    );
  } else {
    const lowCharge = rslope1BN.multipliedBy(optimalUtilizationBN);
    const highCharge = utilizationRateBN
      .minus(optimalUtilizationBN)
      .multipliedBy(rslope2BN);

    return BigInt(
      Math.floor(
        Number(
          baseInterestRateBN
            .plus(lowCharge)
            .plus(highCharge)
            .dividedBy(1000000)
            .toNumber()
        )
      )
    );
  }
}

export function calculateInterestAmount(
  interestRate: bigint,
  loanAmount: bigint,
  loanStartTs: bigint,
  currentTs: number
): bigint {
  const secondsInYear = new BigNumber(31536000000);
  const oneMillion = new BigNumber(1000000);
  const interestRateBN = new BigNumber(Number(interestRate));
  const loanAmountBN = new BigNumber(Number(loanAmount));
  const loanStartTsBN = new BigNumber(Number(loanStartTs));
  const currentTsBN = new BigNumber(Number(currentTs));

  const resultInterestAmount = BigInt(
    Math.ceil(
      loanAmountBN
        .multipliedBy(interestRateBN)
        .multipliedBy(currentTsBN.minus(loanStartTsBN))
        .div(secondsInYear.multipliedBy(oneMillion))
        .toNumber()
    )
  );

  if (resultInterestAmount > 0) {
    return resultInterestAmount;
  } else {
    return 1n;
  }
}

export function getValidityRange(
  lucid: Translucent,
  now: number
): ValidityRange {
  const validFromInit = new Date(now).getTime() - 120000;
  const validToInit = new Date(validFromInit).getTime() + 45 * 60 * 1000; // add 45 minutes (TTL: time to live);

  const validFromSlot = lucid.utils.unixTimeToSlot(validFromInit);
  const validToSlot = lucid.utils.unixTimeToSlot(validToInit);

  const validFrom = lucid.utils.slotToUnixTime(validFromSlot);
  const validTo = lucid.utils.slotToUnixTime(validToSlot);

  return { validFrom, validTo };
}

export function getExpectedValueMap(value: Map<string, Map<string, bigint>>) {
  const toReceive: { [assetId: string]: bigint } = {};

  for (const [policyId, assetMap] of value) {
    for (const [assetName, amount] of assetMap) {
      toReceive[toUnitOrLovelace(policyId, assetName)] = amount;
    }
  }

  return toReceive;
}

export function constructValueWithMinAda(
  value: Map<string, Map<string, bigint>>
) {
  const adaAmount = value.get("")?.get("") || 0n;
  if (adaAmount < MIN_ADA) {
    const newValue = new Map<string, Map<string, bigint>>();
    newValue.set("", new Map([["", MIN_ADA]]));
    for (const [policyId, assetMap] of value) {
      for (const [assetName, amount] of assetMap) {
        if (policyId == "") {
          continue;
        }
        newValue.set(policyId, new Map([[assetName, amount]]));
      }
    }
    return newValue;
  }

  return value;
}

export function toUnitOrLovelace(policyId: PolicyId, assetName?: string): Unit {
  if (policyId + assetName === "") {
    return "lovelace";
  }
  return toUnit(policyId, assetName);
}

export function collectValidators(
  lucid: Translucent,
  poolConfig: PoolConfigSpend["datum"],
  poolTokenName: string,
  govTokenName: string
) {
  // Deploy all related contracts

  const delegatorNftPolicy = new PlaceholderNftPlaceholderNft(3n);
  const delegatorNftPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(delegatorNftPolicy);

  const tempGovTokenPolicy = new PlaceholderNftPlaceholderNft(7n); // Making up the token. But it could be basically any NFT or even adahandle.
  const govNft = {
    policyId: lucid.utils.mintingPolicyToId(tempGovTokenPolicy),
    assetName: govTokenName,
  };

  const oracleNftPolicy = new PlaceholderNftPlaceholderNft(1n);
  const oracleNftPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(oracleNftPolicy);

  const poolConfigValidator = new PoolConfigSpend(govNft, poolConfig);
  const poolConfigPolicy = new PoolConfigMint(govNft, poolConfig);
  const poolConfigPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(poolConfigPolicy);
  const poolValidator = new PoolSpend(delegatorNftPolicyId, poolConfigPolicyId);
  const poolScriptHash = lucid.utils.validatorToScriptHash(poolValidator);

  const lpTokenPolicy = new LiquidityTokenLiquidityToken(
    poolScriptHash,
    poolTokenName
  );
  const lpTokenPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(lpTokenPolicy);

  const leftoverValidator = new LeftoversLeftovers();
  const leftoverValidatorPkh =
    lucid.utils.validatorToScriptHash(leftoverValidator);

  const mergeScript = new DelayedMergeSpend(poolScriptHash);
  const mergeScriptHash = lucid.utils.validatorToScriptHash(mergeScript);

  const collateralValidator = new CollateralSpend({
    poolScriptHash: poolScriptHash,
    liquidationsPkh: leftoverValidatorPkh,
    paramMergeScriptHash: mergeScriptHash,
  });

  const collateralValidatorHash =
    lucid.utils.validatorToScriptHash(collateralValidator);

  const orderContractBorrow = new OrderContractBorrowOrderContract();
  const orderContractDeposit = new OrderContractDepositOrderContract();
  const orderContractRepay = new OrderContractRepayOrderContract();
  const orderContractWithdraw = new OrderContractWithdrawOrderContract();

  return {
    poolScriptHash,
    delegatorNftPolicy,
    delegatorNftPolicyId,
    poolValidator,
    lpTokenPolicy,
    poolConfigValidator,
    orderContractBorrow,
    orderContractDeposit,
    orderContractWithdraw,
    orderContractRepay,
    lpTokenPolicyId,
    leftoverValidator,
    leftoverValidatorPkh,
    poolConfigPolicy,
    poolConfigPolicyId,
    collateralValidator,
    collateralValidatorHash,
    oracleNftPolicyId,
    oracleNftPolicy,
    mergeScript,
    mergeScriptHash,
    govNft,
  };
}
export type Validators = ReturnType<typeof collectValidators>;
export interface ValidatorRefs {
  validators: Validators;
  deployedValidators: DeployedValidators;
}
// Maps validator names to the UTxO that contains them as a reference
export type DeployedValidators = Record<string, UTxO>;

// Pull latest Pool Utxo from Redis.
// If not available get it from blockfrost
export async function getPoolArtifacts(
  poolTokenName: string,
  validators: Validators,
  lucid: Translucent
) {
  const poolUTxO = await lucid.provider.getUtxoByUnit(
    validators.poolScriptHash + poolTokenName
  );

  const poolDatumMapped: PoolSpend["datum"] = Data.from<PoolSpend["datum"]>(
    poolUTxO.datum!,
    PoolSpend["datum"]
  );

  const configUTxO = await lucid.provider.getUtxoByUnit(
    toUnit(
      validators.poolConfigPolicyId,
      poolDatumMapped.params.poolConfigAssetname
    )
  );

  if (configUTxO == null) {
    throw "Could not find pool config";
  }

  const poolConfigDatum: PoolConfigSpend["datum"] = Data.from<
    PoolConfigSpend["datum"]
  >(configUTxO.datum!, PoolConfigSpend["datum"]);

  return {
    configUTxO,
    poolUTxO,
    poolDatumMapped,
    poolConfigDatum,
  };
}

export type PoolArtifacts = Awaited<ReturnType<typeof getPoolArtifacts>>;

export function getOutputReference(utxo: UTxO) {
  return {
    transactionId: { hash: utxo.txHash },
    outputIndex: BigInt(utxo.outputIndex),
  };
}

export function getValueFromDatum(
  datum:
    | OrderContractDepositOrderContract["datum"]
    | OrderContractWithdrawOrderContract["datum"],
  currency: string,
  token: string
): bigint | undefined {
  const valueMap = datum.order.partialOutput.value;
  const tokenMap = valueMap.get(currency);

  if (!tokenMap) {
    console.error(`No token map found for currency: ${currency}`);
    return undefined;
  }

  const value = tokenMap.get(token);
  if (value === undefined) {
    console.error(`No value found for token: ${token}`);
    return undefined;
  }
  return value;
}

type AggregatedDeposits = Map<string, Map<string, bigint>>;

export const aggregateDeposits = (deposits: Asset[]): AggregatedDeposits => {
  const result = new Map<string, Map<string, bigint>>();
  for (const deposit of deposits) {
    const { policyId, assetName, amount } = deposit;

    let assetMap = result.get(policyId);
    if (!assetMap) {
      assetMap = new Map<string, bigint>();
      result.set(policyId, assetMap);
    }

    let currentAmount = assetMap.get(assetName) || BigInt(0);
    currentAmount += BigInt(amount);
    assetMap.set(assetName, currentAmount);
  }

  // Sort by policyId, assetName and then amount
  const sortedResult = new Map<string, Map<string, bigint>>(
    [...result.entries()].sort()
  );

  for (const [policyId, assetMap] of sortedResult) {
    const sortedAssetMap = new Map<string, bigint>(
      [...assetMap.entries()].sort()
    );
    sortedResult.set(policyId, sortedAssetMap);
  }

  return sortedResult;
};

export const OutputReferenceT = Object.assign({
  title: "OutputReference",
  dataType: "constructor",
  index: 0,
  fields: [
    {
      title: "transactionId",
      description:
        "A unique transaction identifier, as the hash of a transaction body. Note that the transaction id\n isn't a direct hash of the `Transaction` as visible on-chain. Rather, they correspond to hash\n digests of transaction body as they are serialized on the network.",
      anyOf: [
        {
          title: "TransactionId",
          dataType: "constructor",
          index: 0,
          fields: [{ dataType: "bytes", title: "hash" }],
        },
      ],
    },
    { dataType: "integer", title: "outputIndex" },
  ],
});

export function nameFromUTxO(utxo: UTxO) {
  const { hash_blake2b256 } = C;
  const the_output_reference = Data.to<OutputReference>(
    {
      transactionId: { hash: utxo.txHash },
      outputIndex: BigInt(utxo.outputIndex),
    },
    OutputReferenceT
  );
  const assetName = toHex(hash_blake2b256(fromHex(the_output_reference)));
  return assetName;
}

export function getAdaAmountIfBought(
  assetAPolicyId: PolicyId,
  assetATokenName: string,
  oracleDatum: OracleValidatorWithdrawValidate["redeemer"],
  assetAmount: bigint
): bigint {
  if ("Pooled" in oracleDatum.data) {
    // Existing logic for Pooled
    const pooledData = oracleDatum.data.Pooled.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!pooledData) {
      throw "Token not found in Pooled price feed 1 ";
    }
    const assetAmountBN = new BigNumber(Number(assetAmount));
    const tokenAAmountBN = new BigNumber(Number(pooledData.tokenAAmount));
    const tokenBAmountBN = new BigNumber(Number(pooledData.tokenBAmount));

    return BigInt(
      Math.floor(
        Number(
          assetAmountBN
            .multipliedBy(1000)
            .multipliedBy(tokenBAmountBN)
            .dividedBy(tokenAAmountBN.minus(assetAmountBN).multipliedBy(997))
        )
      )
    );
  } else if ("Aggregated" in oracleDatum.data) {
    // New logic for Aggregated
    const aggregatedData = oracleDatum.data.Aggregated.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!aggregatedData) {
      throw "Token not found in Aggregated price feed";
    }

    const assetAmountBN = new BigNumber(Number(assetAmount));
    const tokenPrice = new BigNumber(
      Number(aggregatedData.tokenPriceInLovelaces)
    ).dividedBy(Number(aggregatedData.denominator));

    const tokenPriceBN = assetAmountBN.multipliedBy(tokenPrice);

    return BigInt(Math.floor(tokenPriceBN.toNumber()));
  } else {
    throw "Invalid price feed data";
  }
}

export function getAdaAmountIfSold(
  assetAPolicyId: PolicyId,
  assetATokenName: string,
  oracleDatum: OracleValidatorWithdrawValidate["redeemer"],
  assetAmount: bigint
): bigint {
  if ("Pooled" in oracleDatum.data) {
    const pooledData = oracleDatum.data.Pooled.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!pooledData) {
      throw "Token not found in Pooled price feed";
    }
    const assetAmountBN = new BigNumber(Number(assetAmount));
    const tokenAAmountBN = new BigNumber(Number(pooledData.tokenAAmount));
    const tokenBAmountBN = new BigNumber(Number(pooledData.tokenBAmount));

    return BigInt(
      Math.floor(
        Number(
          assetAmountBN
            .multipliedBy(997)
            .multipliedBy(tokenBAmountBN)
            .dividedBy(
              tokenAAmountBN
                .multipliedBy(1000)
                .plus(assetAmountBN.multipliedBy(997))
            )
        )
      )
    );
  } else if ("Aggregated" in oracleDatum.data) {
    const aggregatedData = oracleDatum.data.Aggregated.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!aggregatedData) {
      throw "Token not found in Aggregated price feed 1";
    }

    const assetAmountBN = new BigNumber(Number(assetAmount));
    const tokenPrice = new BigNumber(
      Number(aggregatedData.tokenPriceInLovelaces)
    ).dividedBy(Number(aggregatedData.denominator));

    const tokenPriceBN = assetAmountBN.multipliedBy(tokenPrice);

    return BigInt(Math.floor(tokenPriceBN.toNumber()));

    // return BigInt(
    //   Math.floor(
    //     Number(
    //       new BigNumber(Number(assetAmount))
    //         .multipliedBy(Number(aggregatedData.tokenPriceInLovelaces))
    //         .dividedBy(Number(aggregatedData.denominator))
    //     )
    //   )
    // );
  } else {
    throw "Invalid price feed data";
  }
}

export function assetGainAdaSale(
  oracleDatum: OracleValidatorWithdrawValidate["redeemer"],
  sellAmount: bigint,
  assetAPolicyId: string,
  assetATokenName: string
): bigint {
  if ("Pooled" in oracleDatum.data) {
    const pooledData = oracleDatum.data.Pooled.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!pooledData) {
      throw new Error("Token not found in Pooled price feed");
    }

    const sellAmountBN = new BigNumber(Number(sellAmount));
    const token1AmountBN = new BigNumber(Number(pooledData.tokenBAmount));
    const token2AmountBN = new BigNumber(Number(pooledData.tokenAAmount));

    const nominator = sellAmountBN
      .multipliedBy(997)
      .multipliedBy(token1AmountBN);
    const denominator = token2AmountBN
      .multipliedBy(1000)
      .plus(sellAmountBN.multipliedBy(997));

    const result = BigInt(
      nominator
        .dividedBy(denominator)
        .integerValue(BigNumber.ROUND_FLOOR)
        .toString()
    );

    return result;

    // return amount;
  } else if ("Aggregated" in oracleDatum.data) {
    const aggregatedData = oracleDatum.data.Aggregated.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!aggregatedData) {
      throw new Error("Token not found in Aggregated price feed");
    }

    // Assuming a similar calculation is required for Aggregated data
    // Replace with the appropriate logic as needed
    const adaSellAmountBN = new BigNumber(Number(sellAmount));

    const priceInLovelaces = new BigNumber(
      Number(aggregatedData.tokenPriceInLovelaces)
    );
    const denominator = new BigNumber(Number(aggregatedData.denominator));

    return BigInt(
      adaSellAmountBN
        .dividedBy(priceInLovelaces.dividedBy(denominator))
        .integerValue(BigNumber.ROUND_FLOOR)
        .toString()
    );
  } else {
    throw new Error("Invalid price feed data");
  }
}

export async function calculateLoanValue(
  poolDatumMapped: PoolSpend["datum"],
  collateralDatumMapped: CollateralSpend["datum"],
  loan: LoanDetails,
  accumulatedInterest: bigint,
  lucid: Translucent,
  oracleUtxos: UTxO[],
  oracleValidators: {
    rewardAddress: string;
    validator: Validator;
    redeemer: OracleValidatorWithdrawValidate["redeemer"];
  }[]
) {
  let debtValueInAda: bigint = 0n;

  if (
    poolDatumMapped.params.loanCs.policyId !== "" &&
    loan.loanOracleDetails != null &&
    loan.loanOracleValidator != null
  ) {
    debtValueInAda = getAdaAmountIfBought(
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName,
      loan.loanOracleDetails,
      BigInt(collateralDatumMapped.loanAmount) + BigInt(accumulatedInterest)
    );

    const oracleLoanlAsset =
      poolDatumMapped.params.oracleLoanAsset.policyId +
      poolDatumMapped.params.oracleLoanAsset.assetName;
    const loanOracleUtxo: UTxO =
      await lucid.provider.getUtxoByUnit(oracleLoanlAsset);
    if (loanOracleUtxo == null) {
      throw new Error(
        `Loan oracle utxo not found for asset ${oracleLoanlAsset}`
      );
    }
    oracleUtxos.push(loanOracleUtxo);
    oracleValidators.push({
      validator: loan.loanOracleValidator,
      rewardAddress: lucid.utils.validatorToRewardAddress(
        loan.loanOracleValidator
      ),
      redeemer: loan.loanOracleDetails,
    });
  } else {
    debtValueInAda =
      BigInt(collateralDatumMapped.loanAmount) + BigInt(accumulatedInterest);
  }

  return { debtValueInAda, oracleUtxos, oracleValidators };
}

export async function calculateCollateralValue(
  poolDatumMapped: PoolSpend["datum"],
  collateralDatumMapped: CollateralSpend["datum"],
  loan: LoanDetails,
  lucid: Translucent,
  oracleUtxos: UTxO[],
  oracleValidators: {
    rewardAddress: string;
    validator: Validator;
    redeemer: OracleValidatorWithdrawValidate["redeemer"];
  }[]
) {
  let collateralValueInAda: bigint = 0n;

  if (
    poolDatumMapped.params.collateralCs.policyId !== "" &&
    loan.collateralOracleDetails != null &&
    loan.collateralOracleValidator != null
  ) {
    collateralValueInAda = getAdaAmountIfSold(
      poolDatumMapped.params.collateralCs.policyId,
      poolDatumMapped.params.collateralCs.assetName,
      loan.collateralOracleDetails,
      BigInt(collateralDatumMapped.collateralAmount)
    );

    const oracleCollaterallAsset =
      poolDatumMapped.params.oracleCollateralAsset.policyId +
      poolDatumMapped.params.oracleCollateralAsset.assetName;

    const collateralOracleUtxo: UTxO = await lucid.provider.getUtxoByUnit(
      oracleCollaterallAsset
    );

    oracleUtxos.push(collateralOracleUtxo);
    oracleValidators.push({
      validator: loan.collateralOracleValidator,
      rewardAddress: lucid.utils.validatorToRewardAddress(
        loan.collateralOracleValidator
      ),
      redeemer: loan.collateralOracleDetails,
    });
  } else {
    collateralValueInAda = collateralDatumMapped.collateralAmount;
  }

  return { collateralValueInAda, oracleUtxos, oracleValidators };
}

export function generateReceiverAddress(
  lucid: Translucent,
  recipientAddress: any
) {
  const stakeCredential =
    recipientAddress.stakeCredential &&
    recipientAddress.stakeCredential.Inline &&
    recipientAddress.stakeCredential.Inline[0] &&
    recipientAddress.stakeCredential.Inline[0].VerificationKeyCredential
      ? lucid.utils.keyHashToCredential(
          recipientAddress.stakeCredential.Inline[0]
            .VerificationKeyCredential[0]
        )
      : undefined;

  const receiverAddress = lucid.utils.credentialToAddress(
    lucid.utils.keyHashToCredential(
      recipientAddress.paymentCredential.VerificationKeyCredential[0]
    ),
    stakeCredential
  );

  return receiverAddress;
}

export function getPlatformFee(
  collateralDatum: CollateralSpend["datum"],
  platformFeeDatum: PoolConfigSpend["datum"]
): bigint {
  const utilizationRate =
    (collateralDatum.loanAmount * 1000000n) /
    (collateralDatum.lentOut + collateralDatum.balance);

  if (utilizationRate < platformFeeDatum.loanFeeDetails.tier_1Threshold) {
    return platformFeeDatum.loanFeeDetails.tier_1Fee;
  } else if (
    utilizationRate < platformFeeDatum.loanFeeDetails.tier_2Threshold
  ) {
    return platformFeeDatum.loanFeeDetails.tier_2Fee;
  } else {
    return platformFeeDatum.loanFeeDetails.tier_3Fee;
  }
}

export type OutputValue = { [key: string]: bigint };

export function updateUserValue(
  userValues: OutputValue,
  newValue: OutputValue
): OutputValue {
  // Merge and sum values for existing keys, or add new keys
  for (const [newKey, newVal] of Object.entries(newValue)) {
    userValues[newKey] = (userValues[newKey] || 0n) + newVal;
  }

  // Create a new object with keys sorted, placing 'lovelace' first
  const sortedUserValues: OutputValue = {};
  const keys = Object.keys(userValues).sort((a, b) => {
    if (a === "lovelace") return -1;
    if (b === "lovelace") return 1;
    return a.localeCompare(b);
  });

  keys.forEach((key) => {
    sortedUserValues[key] = userValues[key];
  });

  return sortedUserValues;
}

export function getValueFromMap(map, policy, assetName) {
  // Split the combined key into two parts
  // const [key1, key2] = combinedKey.split('+');

  // Access the nested map using the first key
  const nestedMap = map.get(policy);

  // If the nested map exists, retrieve the value using the second key
  if (nestedMap) {
    return nestedMap.get(assetName);
  }

  // Return null or a default value if the keys are not found
  return null;
}
