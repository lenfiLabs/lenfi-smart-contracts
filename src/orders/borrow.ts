import { ValidityRange } from "./../types";
import {
  Data,
  getAddressDetails,
  Credential,
  Translucent,
  Tx,
} from "translucent-cardano";
import {
  constructValueWithMinAda,
  getInterestRates,
  getPoolArtifacts,
  getValidityRange,
  MIN_ADA,
  OutputValue,
  toUnitOrLovelace,
  updateUserValue,
} from "./../../src/util.ts";

import { OrderContractBorrowOrderContract } from "./../../plutus.ts";
import { ValidatorRefs } from "./../../src/util.ts";

interface BatcherBorrowArgs {
  loanAmount: bigint; // Amount user want to borrow
  collateralAmount: bigint; // Amount user is depositing
  poolTokenName: string; // Pool NFT name
}

export async function placeBorrowOrder(
  lucid: Translucent,
  tx: Tx,
  now: number,
  { loanAmount, collateralAmount, poolTokenName }: BatcherBorrowArgs,
  { validators }: ValidatorRefs
) {
  const validityRange: ValidityRange = getValidityRange(lucid, now);
  const batcherAddress = lucid.utils.validatorToAddress(
    validators.orderContractBorrow
  );
  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );
  const poolDatumMapped = poolArtifacts.poolDatumMapped;
  const poolAddressDetails = getAddressDetails(poolArtifacts.poolUTxO.address);

  poolDatumMapped.balance = poolDatumMapped.balance - loanAmount;

  poolDatumMapped.lentOut = poolDatumMapped.lentOut + loanAmount;

  let maxInterestRate = getInterestRates(
    poolArtifacts.poolConfigDatum.interestParams,
    loanAmount,
    poolDatumMapped.lentOut,
    poolDatumMapped.balance
  );

  maxInterestRate = maxInterestRate;

  const walletAddress = await lucid.wallet.address();
  const walletDetails = getAddressDetails(walletAddress);

  const expectedOutput = new Map([
    [
      poolArtifacts.poolDatumMapped.params.loanCs.policyId,
      new Map([
        [
          poolArtifacts.poolDatumMapped.params.loanCs.assetName,
          BigInt(loanAmount),
        ],
      ]),
    ],
  ]);

  let stakeCredentials: any | null = null; // initialize to null

  if (poolAddressDetails["stakeCredential"]) {
    if (poolAddressDetails["stakeCredential"]["type"] === "Key") {
      stakeCredentials = {
        Inline: [
          {
            VerificationKeyCredential: [
              poolAddressDetails["stakeCredential"]["hash"],
            ],
          },
        ],
      };
    } else if (poolAddressDetails["stakeCredential"]["type"] === "Script") {
      stakeCredentials = {
        Inline: [
          {
            ScriptCredential: [poolAddressDetails["stakeCredential"]["hash"]],
          },
        ],
      };
    }
  }

  const batcherDatum: OrderContractBorrowOrderContract["datum"] = {
    controlCredential: {
      VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
    },
    poolNftCs: {
      policyId: validators.poolScriptHash,
      assetName: poolTokenName,
    },
    batcherFeeAda: 2000000n,
    order: {
      expectedOutput: {
        address: {
          paymentCredential: {
            VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
          },
          stakeCredential: null,
        },
        value: constructValueWithMinAda(expectedOutput),
        datum: "NoDatum",
        referenceScript: null,
      },
      partialOutput: {
        address: {
          paymentCredential: {
            VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
          },
          stakeCredential: null,
        },
        value: new Map([["", new Map([["", MIN_ADA]])]]),
        datum: "NoDatum",
      },
      borrowerNftPolicy: validators.collateralValidatorHash,
      minCollateralAmount: BigInt(collateralAmount),
      minDepositTime: BigInt(validityRange.validFrom),
      maxInterestRate: BigInt(maxInterestRate),
      collateralAddress: {
        paymentCredential: {
          ScriptCredential: [validators.collateralValidatorHash],
        },
        stakeCredential: stakeCredentials,
      },
    },
  };

  const metadata = {
    msg: ["Lenfi: BORROW order submitted."],
  };

  const depositValue = {
    [toUnitOrLovelace(
      poolDatumMapped.params.collateralCs.policyId,
      poolDatumMapped.params.collateralCs.assetName
    )]: BigInt(collateralAmount),
  };

  let valueSendToBatcher: OutputValue = { lovelace: 4000000n };

  // Add new value to the datum value
  valueSendToBatcher = updateUserValue(valueSendToBatcher, depositValue);

  const txBuilder = tx
    .payToContract(
      batcherAddress,
      { inline: Data.to(batcherDatum, OrderContractBorrowOrderContract.datum) },
      valueSendToBatcher
    )
    .attachMetadata(674, metadata);

  return { txBuilder };
}
