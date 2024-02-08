import { PriceFeed } from "../../../src/types.ts";
import { Data } from "translucent-cardano";

import {
  LENFI_POLICY_ID,
  LENFI_TOKEN_NAME,
  MIN_POLICY_ID,
  MIN_TOKEN_NAME,
} from "../utils.ts";
import { Oracle } from "./oracle.ts";
import {
  OracleValidatorFeedType,
  OracleValidatorWithdrawValidate,
} from "../../../plutus.ts";

// Define a type for the feeds
type Feeds = {
  [key: string]: PriceFeed;
};

const validTo = 1736683741000n;
const feeds: Feeds = {
  lenfiAggregatedCheap: {
    Aggregated: [
      {
        token: {
          policyId: LENFI_POLICY_ID,
          assetName: LENFI_TOKEN_NAME,
        },
        tokenPriceInLovelaces: 1n,
        denominator: 10n,
        validTo,
      },
    ],
  },
  lenfiAggregatedExpensive: {
    Aggregated: [
      {
        token: {
          policyId: LENFI_POLICY_ID,
          assetName: LENFI_TOKEN_NAME,
        },
        tokenPriceInLovelaces: 24n,
        denominator: 10n,
        validTo,
      },
    ],
  },
  lenfiAggregatedFairlyCheap: {
    Aggregated: [
      {
        token: {
          policyId: LENFI_POLICY_ID,
          assetName: LENFI_TOKEN_NAME,
        },
        tokenPriceInLovelaces: 1n,
        denominator: 3n,
        validTo,
      },
    ],
  },
  lenfiAggregatedFairlyExpensive: {
    Aggregated: [
      {
        token: {
          policyId: LENFI_POLICY_ID,
          assetName: LENFI_TOKEN_NAME,
        },
        tokenPriceInLovelaces: 2n,
        denominator: 3n,
        validTo,
      },
    ],
  },
  minAggregatedCheap: {
    Aggregated: [
      {
        token: {
          policyId: MIN_POLICY_ID,
          assetName: MIN_TOKEN_NAME,
        },
        tokenPriceInLovelaces: 1n,
        denominator: 10n,
        validTo,
      },
    ],
  },
  minAggregatedFairlyCheap: {
    Aggregated: [
      {
        token: {
          policyId: MIN_POLICY_ID,
          assetName: MIN_TOKEN_NAME,
        },
        tokenPriceInLovelaces: 1n,
        denominator: 3n,
        validTo,
      },
    ],
  },
  minAggregatedExpensive: {
    Aggregated: [
      {
        token: {
          policyId: MIN_POLICY_ID,
          assetName: MIN_TOKEN_NAME,
        },
        tokenPriceInLovelaces: 1n,
        denominator: 1n,
        validTo,
      },
    ],
  },
  minAggregatedFairlyExpensive: {
    Aggregated: [
      {
        token: {
          policyId: MIN_POLICY_ID,
          assetName: MIN_TOKEN_NAME,
        },
        tokenPriceInLovelaces: 2n,
        denominator: 8n,
        validTo,
      },
    ],
  },
  lenfiPooledCheap: {
    Pooled: [
      {
        token: {
          policyId: LENFI_POLICY_ID,
          assetName: LENFI_TOKEN_NAME,
        },
        tokenAAmount: 10000000000000n,
        tokenBAmount: 1000000000000n,
        validTo,
      },
    ],
  },
  lenfiPooledExpensive: {
    Pooled: [
      {
        token: {
          policyId: LENFI_POLICY_ID,
          assetName: LENFI_TOKEN_NAME,
        },
        tokenAAmount: 1000000000000n,
        tokenBAmount: 2500000000000n,
        validTo,
      },
    ],
  },
  lenfiPooledFairlyCheap: {
    Pooled: [
      {
        token: {
          policyId: LENFI_POLICY_ID,
          assetName: LENFI_TOKEN_NAME,
        },
        tokenAAmount: 3000000000000n,
        tokenBAmount: 4000000000000n,
        validTo,
      },
    ],
  },
  lenfiPooledFairlyExpensive: {
    Pooled: [
      {
        token: {
          policyId: LENFI_POLICY_ID,
          assetName: LENFI_TOKEN_NAME,
        },
        tokenAAmount: 1800000000000n,
        tokenBAmount: 2500000000000n,
        validTo,
      },
    ],
  },
  lenfiExpiredOracle: {
    Pooled: [
      {
        token: {
          policyId: LENFI_POLICY_ID,
          assetName: LENFI_TOKEN_NAME,
        },
        tokenAAmount: 1800000000000n,
        tokenBAmount: 2500000000000n,
        validTo: 123n,
      },
    ],
  },
  minExpiredOracle: {
    Pooled: [
      {
        token: {
          policyId: MIN_POLICY_ID,
          assetName: MIN_TOKEN_NAME,
        },
        tokenAAmount: 1800000000000n,
        tokenBAmount: 2500000000000n,
        validTo: 123n,
      },
    ],
  },
};

export const signedOracleFeed = async (
  feedName: string
): Promise<OracleValidatorWithdrawValidate["redeemer"]> => {
  const datum = Data.to(feeds[feedName], OracleValidatorFeedType["_redeemer"]);

  const oracle = new Oracle({ readFromFile: "./tests/pool/oracle/keys.sk" });
  const signedData = await oracle.signFeed(datum);

  const oracle2 = new Oracle({ readFromFile: "./tests/pool/oracle/keys2.sk" });
  const signedData2 = await oracle2.signFeed(datum);

  const result: OracleValidatorWithdrawValidate["redeemer"] = {
    data: feeds[feedName],
    signatures: [
      {
        signature: signedData.signature,
        keyPosition: 0n,
      },
      // {
      //   signature: signedData2.signature,
      //   keyPosition: 1n,
      // }
    ],
  };
  return result;
};
