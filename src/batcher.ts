import {
  Data,
  fromHex,
  toHex,
  toUnit,
  Translucent,
  Tx,
  UTxO,
  Validator,
} from "translucent-cardano";
import { C } from "lucid-cardano";

import {
  calculateBalanceToDeposit,
  calculateLpTokens,
  generateReceiverAddress,
  getExpectedValueMap,
  getPoolArtifacts,
  getValueFromDatum,
  getValueFromMap,
  MIN_ADA,
  nameFromUTxO,
  OutputValue,
  toUnitOrLovelace,
  updateUserValue,
  utxoToOref,
  ValidatorRefs,
} from "./util.ts";

import {
  CollateralSpend,
  OracleValidatorWithdrawValidate,
  OrderContractBorrowOrderContract,
  OrderContractDepositOrderContract,
  OrderContractOutputreftype,
  OrderContractRepayOrderContract,
  OrderContractWithdrawOrderContract,
  PoolSpend,
} from "./../plutus.ts";
import { makeBorrow } from "./pool/borrow.ts";
import { makeRepay } from "./pool/repay.ts";
import { makeDeposit } from "./pool/deposit.ts";
import { makeWithdrawal } from "./pool/withdraw.ts";
import { LoanDetails, LpTokenCalculation } from "./types.ts";

export type ActionName = "Deposit" | "Withdraw" | "Repay" | "Borrow";

type BatcherOutput = {
  receiverAddress: string;
  datum:
    | {
        inline: string; // datum is an object with an 'inline' property, which is a string
      }
    | "";
  value: OutputValue;
};
interface BatcherTxBuilder {
  txBuilder: Tx;
  receiverDetails: BatcherOutput[];
  referenceScriptUtxo: UTxO[];
  batcherRedeemer: string;
  borrowerTokenName?: string;
}

function batcherTxMixin(batcherUtxo: UTxO) {
  return function ({
    txBuilder,
    receiverDetails,
    referenceScriptUtxo,
    batcherRedeemer,
    borrowerTokenName,
  }: BatcherTxBuilder) {
    // Validate inputs

    let tx = txBuilder;
    for (const output of receiverDetails) {
      if (output.datum === "") {
        tx = tx.payToAddress(output.receiverAddress, output.value);
      } else {
        tx = tx.payToContract(
          output.receiverAddress,
          output.datum,
          output.value
        );
      }
    }

    tx = tx
      .collectFrom([batcherUtxo], batcherRedeemer)
      .readFrom(referenceScriptUtxo);

    return { txBuilder: tx, borrowerTokenName };
  };
}

export async function executeOrder(
  orderType: ActionName,
  lucid: Translucent,
  tx: Tx,
  batcherUtxo: UTxO,
  poolStakeValidator: Validator,
  collateralOracle: Validator,
  loanOracle: Validator,
  { validators, deployedValidators }: ValidatorRefs,
  now: number,
  continuingOutputIdx: bigint,
  loanOracleDetails?: OracleValidatorWithdrawValidate["redeemer"],
  collateralOracleDetails?: OracleValidatorWithdrawValidate["redeemer"]
) {
  try {
    let batcherPromise: Promise<BatcherTxBuilder>;

    switch (orderType) {
      case "Borrow":
        batcherPromise = executeBorrowOrder(
          lucid,
          tx,
          batcherUtxo,
          continuingOutputIdx,
          now,
          poolStakeValidator,
          collateralOracle,
          loanOracle,
          {
            validators,
            deployedValidators,
          },
          loanOracleDetails,
          collateralOracleDetails
        );
        break;
      case "Repay":
        batcherPromise = executeRepayOrder(
          lucid,
          tx,
          batcherUtxo,
          continuingOutputIdx,
          now,
          poolStakeValidator,
          {
            validators,
            deployedValidators,
          }
        );
        break;
      case "Withdraw":
        batcherPromise = executeWithdrawOrder(
          lucid,
          tx,
          batcherUtxo,
          continuingOutputIdx!,
          poolStakeValidator,
          {
            validators,
            deployedValidators,
          },
          now
        );

        break;
      case "Deposit":
        batcherPromise = executeDepositOrder(
          lucid,
          tx,
          batcherUtxo,
          continuingOutputIdx!,
          poolStakeValidator,
          {
            validators,
            deployedValidators,
          }
        );

        break;

      default:
        throw new Error("Not implemented");
    }

    const { txBuilder } = await batcherPromise.then(
      batcherTxMixin(batcherUtxo)
    );

    const borrowerTokenName = (await batcherPromise).borrowerTokenName;
    return { txBuilder, borrowerTokenName };
  } catch (error) {
    console.error("Error in executeOrder:", error);
    throw error; // or handle it as needed
  }
}

async function executeDepositOrder(
  lucid: Translucent,
  tx: Tx,
  batcherUtxo: UTxO,
  continuingOutputIdx: bigint,
  poolStakeValidator: Validator,
  { validators, deployedValidators }: ValidatorRefs
) {
  const batcherDatumMapped: OrderContractDepositOrderContract["datum"] =
    await lucid.datumOf(batcherUtxo, OrderContractDepositOrderContract.datum);

  const poolTokenName = batcherDatumMapped.poolNftCs.assetName;

  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );

  const poolDatumMapped: PoolSpend["datum"] = poolArtifacts.poolDatumMapped;

  const lpTokensToDepositDetails: LpTokenCalculation = calculateLpTokens(
    poolDatumMapped.balance,
    poolDatumMapped.lentOut,
    batcherDatumMapped.order.depositAmount,
    poolDatumMapped.totalLpTokens
  );
  const lpTokensToDeposit = lpTokensToDepositDetails.lpTokenMintAmount;

  const batcherRedeemer: OrderContractDepositOrderContract["redeemer"] = {
    Process: {
      poolOref: {
        transactionId: { hash: poolArtifacts.poolUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
      },
      additionalData: undefined,
    },
  };

  const receiverAddress = generateReceiverAddress(
    lucid,
    batcherDatumMapped.order.partialOutput.address
  );

  const toReceive = {
    [poolDatumMapped.params.lpToken.policyId +
    poolDatumMapped.params.lpToken.assetName]: lpTokensToDeposit,
  };

  let valueForUserToReceive: OutputValue = {};

  // Get value from datum output map
  for (const [policyId, assetMap] of batcherDatumMapped.order.partialOutput
    .value) {
    for (const [assetName, amount] of assetMap) {
      valueForUserToReceive[toUnitOrLovelace(policyId, assetName)] = amount;
    }
  }

  // Add new value to the datum value
  valueForUserToReceive = updateUserValue(valueForUserToReceive, toReceive);

  const referenceScriptUtxo = [deployedValidators.orderContractDeposit];

  let datum = "";

  const thisOref: OrderContractOutputreftype["_redeemer"] = {
    transactionId: { hash: batcherUtxo.txHash },
    outputIndex: BigInt(batcherUtxo.outputIndex),
  };

  datum = Data.to(thisOref, OrderContractOutputreftype._redeemer);

  const receiverDetails: BatcherOutput[] = [
    {
      receiverAddress,
      datum: { inline: datum },
      value: valueForUserToReceive,
    },
  ];

  const { txBuilder } = makeDeposit(
    lucid,
    tx,
    continuingOutputIdx,
    {
      balanceToDeposit: batcherDatumMapped.order.depositAmount,
      poolTokenName,
      poolStakeValidator,
      poolArtifacts,
    },
    {
      validators,
      deployedValidators,
    },
    utxoToOref(batcherUtxo),
    0n
  );

  return {
    txBuilder,
    receiverDetails,
    referenceScriptUtxo,
    batcherRedeemer: Data.to(
      batcherRedeemer,
      OrderContractDepositOrderContract["redeemer"]
    ),
    orderRef: utxoToOref(batcherUtxo),
  };
}

async function executeWithdrawOrder(
  lucid: Translucent,
  tx: Tx,
  batcherUtxo: UTxO,
  continuingOutputIdx: bigint,
  poolStakeValidator: Validator,
  { validators, deployedValidators }: ValidatorRefs,
  now: number
) {
  const batcherDatumMapped: OrderContractWithdrawOrderContract["datum"] =
    await lucid.datumOf(batcherUtxo, OrderContractWithdrawOrderContract.datum);

  const poolTokenName = batcherDatumMapped.poolNftCs.assetName;

  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );

  const poolDatumMapped = poolArtifacts.poolDatumMapped;

  const lpTokensBurnAmount = batcherDatumMapped.order.lpTokensBurn;

  const lpTokensToDepositDetails: LpTokenCalculation =
    calculateBalanceToDeposit(
      poolDatumMapped.balance,
      poolDatumMapped.lentOut,
      lpTokensBurnAmount,
      poolDatumMapped.totalLpTokens
    );

  const batcherRedeemer: OrderContractWithdrawOrderContract["redeemer"] = {
    Process: {
      poolOref: {
        transactionId: { hash: poolArtifacts.poolUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
      },
      additionalData: undefined,
    },
  };

  const receiverAddress = generateReceiverAddress(
    lucid,
    batcherDatumMapped.order.partialOutput.address
  );

  const toReceive = {
    [toUnitOrLovelace(
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName
    )]: lpTokensToDepositDetails.depositAmount,
  };

  let valueForUserToReceive: OutputValue = {};

  for (const [policyId, assetMap] of batcherDatumMapped.order.partialOutput
    .value) {
    for (const [assetName, amount] of assetMap) {
      valueForUserToReceive[toUnitOrLovelace(policyId, assetName)] = amount;
    }
  }

  // Add new value to the datum value
  valueForUserToReceive = updateUserValue(valueForUserToReceive, toReceive);

  // const valToReceive = {
  //   [toUnitOrLovelace("", "")]: 2000000n,
  //   ["8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f695874c454e4649"]:
  //     2000000n,
  // };

  // const referenceScriptUtxo = [deployedValidators["orderContractWithdraw"]];
  let datum = "";

  const thisOref: OrderContractOutputreftype["_redeemer"] = {
    transactionId: { hash: batcherUtxo.txHash },
    outputIndex: BigInt(batcherUtxo.outputIndex),
  };

  datum = Data.to(thisOref, OrderContractOutputreftype._redeemer);

  const receiverDetails: BatcherOutput[] = [
    {
      receiverAddress,
      datum: { inline: datum },
      value: valueForUserToReceive,
    },
  ];

  const referenceScriptUtxo = [deployedValidators["orderContractWithdraw"]];

  const { txBuilder } = makeWithdrawal(
    lucid,
    tx,
    now,
    continuingOutputIdx,
    {
      poolTokenName,
      balanceToWithdraw: lpTokensToDepositDetails.depositAmount,
      poolStakeValidator,
      poolArtifacts,
    },
    {
      validators,
      deployedValidators,
    },
    utxoToOref(batcherUtxo),
    0n
  );

  return {
    txBuilder,
    receiverDetails,
    referenceScriptUtxo,
    batcherRedeemer: Data.to(
      batcherRedeemer,
      OrderContractWithdrawOrderContract["redeemer"]
    ),
    orderRef: utxoToOref(batcherUtxo),
  };
}

async function executeBorrowOrder(
  lucid: Translucent,
  tx: Tx,
  batcherUtxo: UTxO,
  continuingOutputIdx: bigint,
  now: number,
  poolStakeValidator: Validator,
  collateralOracleValidator: Validator,
  loanOracleValidator: Validator,
  { validators, deployedValidators }: ValidatorRefs,
  loanOracleDetails?: OracleValidatorWithdrawValidate["redeemer"],
  collateralOracleDetails?: OracleValidatorWithdrawValidate["redeemer"]
) {
  const batcherDatumMapped: OrderContractBorrowOrderContract["datum"] =
    await lucid.datumOf(batcherUtxo, OrderContractBorrowOrderContract.datum);

  const poolTokenName = batcherDatumMapped.poolNftCs.assetName;

  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );

  const expectedOrderValue = batcherDatumMapped.order.expectedOutput.value;

  const loanAmount: bigint = getValueFromMap(
    expectedOrderValue,
    poolArtifacts.poolDatumMapped.params.loanCs.policyId,
    poolArtifacts.poolDatumMapped.params.loanCs.assetName
  );

  const collateralAmount = batcherDatumMapped.order.minCollateralAmount;

  const borrowerTokenName = nameFromUTxO(poolArtifacts.poolUTxO);

  const batcherRedeemer: OrderContractBorrowOrderContract["redeemer"] = {
    Process: {
      poolOref: {
        transactionId: { hash: poolArtifacts.poolUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
      },
      additionalData: {
        borrowerTokenName: borrowerTokenName,
        additionalAda: 0n,
      },
    },
  };

  const referenceScriptUtxo = [deployedValidators.orderContractBorrow];

  const receiverAddress = generateReceiverAddress(
    lucid,
    batcherDatumMapped.order.expectedOutput.address
  );

  const loanToReceive = getExpectedValueMap(
    batcherDatumMapped.order.expectedOutput.value
  );

  const toReceive = {
    [toUnit(validators.collateralValidatorHash, borrowerTokenName)]: 1n,
  };

  let valueForUserToReceive: OutputValue = {};

  for (const [policyId, assetMap] of batcherDatumMapped.order.partialOutput
    .value) {
    for (const [assetName, amount] of assetMap) {
      valueForUserToReceive[toUnitOrLovelace(policyId, assetName)] = amount;
    }
  }
  // Add new value to the datum value
  valueForUserToReceive = updateUserValue(valueForUserToReceive, toReceive);

  let datum = "";

  const thisOref: OrderContractOutputreftype["_redeemer"] = {
    transactionId: { hash: batcherUtxo.txHash },
    outputIndex: BigInt(batcherUtxo.outputIndex),
  };

  datum = Data.to(thisOref, OrderContractOutputreftype._redeemer);

  const receiverDetails: BatcherOutput[] = [
    {
      receiverAddress, // partial output
      datum: "",
      value: valueForUserToReceive,
    },
    {
      receiverAddress,
      datum: "",
      value: loanToReceive,
    },
  ];

  const { txBuilder } = await makeBorrow(
    lucid,
    tx,
    continuingOutputIdx,
    now,
    {
      loanAmount,
      collateralAmount,
      poolTokenName,
      poolStakeValidator,
      collateralOracleValidator,
      loanOracleValidator,
      poolArtifacts,
      borrowerTokenName,
      loanOracleDetails,
      collateralOracleDetails,
    },
    {
      validators,
      deployedValidators,
    },
    utxoToOref(batcherUtxo)
  );

  return {
    txBuilder,
    receiverDetails,
    referenceScriptUtxo,
    batcherRedeemer: Data.to(
      batcherRedeemer,
      OrderContractBorrowOrderContract["redeemer"]
    ),
    orderRef: utxoToOref(batcherUtxo),
    borrowerTokenName,
  };
}

async function executeRepayOrder(
  lucid: Translucent,
  tx: Tx,
  batcherUtxo: UTxO,
  continuingOutputIdx: bigint,
  now: number,
  poolStakeValidator: Validator,
  { validators, deployedValidators }: ValidatorRefs
) {
  const batcherDatumMapped: OrderContractRepayOrderContract["datum"] =
    await lucid.datumOf(batcherUtxo, OrderContractRepayOrderContract.datum);

  const utxoToConsumeCollateral: UTxO[] = await lucid.utxosByOutRef([
    {
      txHash: batcherDatumMapped.order.order.transactionId.hash,
      outputIndex: Number(batcherDatumMapped.order.order.outputIndex),
    },
  ]);

  const collateralDatumMapped: CollateralSpend["datum"] = await lucid.datumOf(
    utxoToConsumeCollateral[0],
    CollateralSpend.datum
  );

  const poolTokenName = batcherDatumMapped.poolNftCs.assetName;

  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );

  const receiverAddress = generateReceiverAddress(
    lucid,
    batcherDatumMapped.order.expectedOutput.address
  );

  const batcherRedeemer: OrderContractRepayOrderContract["redeemer"] = {
    Process: {
      poolOref: {
        transactionId: { hash: poolArtifacts.poolUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
      },
      additionalData: undefined,
    },
  };

  const referenceScriptUtxo = [deployedValidators.orderContractRepay];

  const collateralToReceive = getExpectedValueMap(
    batcherDatumMapped.order.expectedOutput.value
  );

  const loanDetails: LoanDetails[] = [
    {
      loanUtxo: {
        txHash: batcherDatumMapped.order.order.transactionId.hash,
        outputIndex: Number(batcherDatumMapped.order.order.outputIndex),
      },
      poolTokenName,
      borrowerTokenName: collateralDatumMapped.borrowerTn,
      poolStakeValidator,
    },
  ];

  const receiverDetails: BatcherOutput[] = [
    {
      receiverAddress,
      datum: "",
      value: collateralToReceive,
    },
  ];

  const { txBuilder } = await makeRepay(
    lucid,
    tx,
    now,
    loanDetails,
    {
      validators,
      deployedValidators,
    },
    utxoToOref(batcherUtxo)
  );

  return {
    txBuilder,
    receiverAddress,
    receiverDetails,
    referenceScriptUtxo,
    batcherRedeemer: Data.to(
      batcherRedeemer,
      OrderContractRepayOrderContract["redeemer"]
    ),
  };
}
