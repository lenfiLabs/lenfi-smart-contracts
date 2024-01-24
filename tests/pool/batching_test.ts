import { Emulator, Translucent, Validator, OutRef } from "translucent-cardano";
import { createPool, updateConfig } from "./../../src/pool/mod.ts";
import {
  AssetClass,
  createMockOracle,
  generateAccount,
  GeneratedAccount,
  isNewBalanceGreater,
  LENFI_POLICY_ID,
  LENFI_TOKEN_NAME,
  MIN_POLICY_ID,
  MIN_TOKEN_NAME,
  quickSubmitBuilder,
} from "./utils.ts";
import { deployValidators } from "./../../src/deploy_validators.ts";
import {
  collectValidators,
  DeployedValidators,
  toUnitOrLovelace,
  Validators,
} from "./../../src/util.ts";
import { defaultConfig, defaultProtocolParams } from "./../../src/constants.ts";
import {
  cancelOrder,
  placeBorrowOrder,
  placeDepositOrder,
  placeRepayOrder,
  placeWithdrawalOrder,
} from "./../../src/orders/mod.ts";

import { LoanDetails, OutputReference } from "./../../src/types.ts";
import { OracleValidatorWithdrawValidate, PoolSpend } from "./../../plutus.ts";
import { createGovernanceNFT } from "./../../src/pool/create_governance_nft.ts";
import { executeOrder } from "./../../src/batcher.ts";
import { signedOracleFeed } from "./oracle/oracle_feeds.ts";

function testTokenScenario(
  poolName: string,
  { policy: loanTokenPolicy, name: loanTokenName }: AssetClass, // loan
  { policy: collateralTokenPolicy, name: collateralTokenName }: AssetClass, //collateral
  loanAmount: bigint,
  collateralAmount: bigint,
  loanOracle?: OracleValidatorWithdrawValidate["redeemer"],
  collateralOracle?: OracleValidatorWithdrawValidate["redeemer"]
) {
  const loanTokenUnit = toUnitOrLovelace(loanTokenPolicy, loanTokenName);
  const collateralTokenUnit = toUnitOrLovelace(
    collateralTokenPolicy,
    collateralTokenName
  );

  describe(`Batching Tests: ${poolName}`, () => {
    let USER_ACCOUNT: GeneratedAccount;
    let BATCHER_ACCOUNT: GeneratedAccount;
    let THIRD_GUY: GeneratedAccount;
    let emulator: Emulator;
    let lucid: Translucent;
    let validators: Validators;
    let deployedValidators: DeployedValidators;
    let poolTokenName: string;
    let poolStakeValidator: Validator;
    let loanOracleValidator: Validator;
    let collateralOracleValidator: Validator;
    let loanTokenOracleNft: string;
    let collateralTokenOracleNft: string;

    beforeEach(async () => {
      USER_ACCOUNT = await generateAccount({
        [collateralTokenUnit]: 10000000000000n,
        [loanTokenUnit]: 10000000000000n,
        lovelace: 100000000000n,
      });

      BATCHER_ACCOUNT = await generateAccount({
        lovelace: 100000000000n,
        [collateralTokenUnit]: 100000000000n,
        [loanTokenUnit]: 200000000000n,
      });

      THIRD_GUY = await generateAccount({
        lovelace: 100000000000n,
      });

      emulator = new Emulator(
        [USER_ACCOUNT, BATCHER_ACCOUNT, THIRD_GUY],
        defaultProtocolParams
      );
      lucid = await Translucent.new(emulator);

      emulator.awaitBlock(10_000); // For validity ranges to be valid
      lucid.selectWalletFromPrivateKey(USER_ACCOUNT.privateKey);

      emulator.awaitBlock(1);

      const initialOutputRef: OutputReference = {
        transactionId: { hash: "" },
        outputIndex: 0n,
      };

      const govNftResults = await createGovernanceNFT(lucid, lucid.newTx());

      await quickSubmitBuilder(emulator)({
        txBuilder: govNftResults.txBuilder,
      });

      validators = collectValidators(
        lucid,
        defaultConfig,
        "",
        govNftResults.governanceNFTName,
      );

      deployedValidators = await deployValidators(lucid, {
        writeToFile: false,
        validators,
      });
      emulator.awaitBlock(1);

      if (loanTokenUnit !== "lovelace") {
        const oracleResult = await createMockOracle(lucid, lucid.newTx(), 0n, {
          validators,
          deployedValidators,
        });

        loanTokenOracleNft = oracleResult.oracleNft;
        loanOracleValidator = oracleResult.oracleValidator;

        await quickSubmitBuilder(emulator)({
          txBuilder: oracleResult.txBuilder,
        });
      }

      if (collateralTokenUnit !== "lovelace") {
        const oracleResult = await createMockOracle(lucid, lucid.newTx(), 0n, {
          validators,
          deployedValidators,
        });

        collateralTokenOracleNft = oracleResult.oracleNft;
        collateralOracleValidator = oracleResult.oracleValidator;

        await quickSubmitBuilder(emulator)({
          txBuilder: oracleResult.txBuilder,
        });
      }

      const poolCreationResult = await createPool(
        lucid,
        lucid.newTx(),
        0n,
        {
          depositAmount: 90000000n,
          loanToken: loanTokenUnit == "lovelace" ? "" : loanTokenUnit,
          collateralToken:
            collateralTokenUnit == "lovelace" ? "" : collateralTokenUnit,
          collateralOracleNft: collateralTokenOracleNft,
          loanOracleNft: loanTokenOracleNft,
        },
        {
          validators,
          deployedValidators,
        }
      );

      poolTokenName = poolCreationResult.poolId;
      poolStakeValidator = poolCreationResult.stakingValidator;
      await quickSubmitBuilder(emulator)({
        txBuilder: poolCreationResult.txBuilder,
      });
    });

    const runBatcherTestCommands = async () => {
      describe("Deposit Order", () => {
        it("Valid Deposit Order", async () => {
          const txHash = await placeDepositOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              balanceToDeposit: 10_000_000n,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];

          lucid.selectWalletFromPrivateKey(BATCHER_ACCOUNT.privateKey);

          await executeOrder(
            "Deposit",
            lucid,
            lucid.newTx(),
            batcherUtxo,
            poolStakeValidator,
            collateralOracleValidator,
            loanOracleValidator,
            {
              validators,
              deployedValidators,
            },
            emulator.now(),
            0n
          ).then(quickSubmitBuilder(emulator));
        });

        it("Cancel Deposit Order", async () => {
          const txHash = await placeDepositOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              balanceToDeposit: 10_000_000n,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];

          await cancelOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              actionName: "Deposit",
              batcherUtxo,
            },
            {
              validators,
              deployedValidators,
            }
          ).then(quickSubmitBuilder(emulator));
        });
      });

      describe("Withdrawal Order", () => {
        it("Valid Withdrawal Order", async () => {
          const txHash = await placeWithdrawalOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              balanceToWithdraw: 2000000n,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = await lucid.utxosByOutRef([batcherOref]);

          lucid.selectWalletFromPrivateKey(BATCHER_ACCOUNT.privateKey);

          const orderTx = await executeOrder(
            "Withdraw",
            lucid,
            lucid.newTx(),
            batcherUtxo[0],
            poolStakeValidator,
            collateralOracleValidator,
            loanOracleValidator,
            {
              validators,
              deployedValidators,
            },
            emulator.now(),
            0n
          );

          const tx = orderTx.txBuilder;
          tx.collectFrom(await lucid.wallet.getUtxos());

          const wihtdrawTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: tx,
          });
        });

        it("Cancel Withdrawal Order", async () => {
          const txHash = await placeWithdrawalOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              balanceToWithdraw: 2200000n,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];

          await cancelOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              actionName: "Withdraw",
              batcherUtxo,
            },
            {
              validators,
              deployedValidators,
            }
          ).then(quickSubmitBuilder(emulator));
        });
      });

      describe("Borrow Order", () => {
        it("Valid Borrow Order", async () => {
          const txHash = await placeBorrowOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];

          await executeOrder(
            "Borrow",
            lucid,
            lucid.newTx(),
            batcherUtxo,
            poolStakeValidator,
            collateralOracleValidator,
            loanOracleValidator,
            {
              validators,
              deployedValidators,
            },
            emulator.now(),
            0n,
            loanOracle,
            collateralOracle
          ).then(quickSubmitBuilder(emulator));
        });

        it("Cancel Borrow Order", async () => {
          const txHash = await placeBorrowOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanAmount: 50000000n,
              collateralAmount: 50000000n * 2n,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];

          await cancelOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              actionName: "Borrow",
              batcherUtxo,
            },
            {
              validators,
              deployedValidators,
            }
          ).then(quickSubmitBuilder(emulator));
        });
      });

      describe("Existing Loan", () => {
        let loanDetails: LoanDetails[] = [];

        beforeEach(async () => {
          loanDetails = [];
          const txHash = await placeBorrowOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];
          lucid.selectWalletFromPrivateKey(BATCHER_ACCOUNT.privateKey);

          const borrowResult = await executeOrder(
            "Borrow",
            lucid,
            lucid.newTx(),
            batcherUtxo,
            poolStakeValidator,
            collateralOracleValidator,
            loanOracleValidator,
            {
              validators,
              deployedValidators,
            },
            emulator.now(),
            0n,
            loanOracle,
            collateralOracle
          );

          const borrowTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResult.txBuilder,
          });

          const borrowOutput = 1;
          if (!borrowResult.borrowerTokenName) {
            throw new Error("Borrower token name not found");
          }

          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash, outputIndex: borrowOutput },
            poolTokenName: poolTokenName,
            borrowerTokenName: borrowResult.borrowerTokenName,
            poolStakeValidator: poolStakeValidator,
            loanOracleValidator: loanOracleValidator,
            collateralOracleValidator: collateralOracleValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
          });
        });

        it("Valid Repay Order", async () => {
          lucid.selectWalletFromPrivateKey(USER_ACCOUNT.privateKey);
          const txHash = await placeRepayOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            loanDetails,
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];
          lucid.selectWalletFromPrivateKey(BATCHER_ACCOUNT.privateKey);
          const repayOrder = await executeOrder(
            "Repay",
            lucid,
            lucid.newTx(),
            batcherUtxo,
            poolStakeValidator,
            collateralOracleValidator,
            loanOracleValidator,
            {
              validators,
              deployedValidators,
            },
            emulator.now(),
            0n
          );
          let tx = repayOrder.txBuilder;
          tx.collectFrom(await lucid.wallet.getUtxos());

          await quickSubmitBuilder(emulator)({
            txBuilder: tx,
          });
        });

        it("Cancel Repay Order", async () => {
          lucid.selectWalletFromPrivateKey(USER_ACCOUNT.privateKey);

          const txHash = await placeRepayOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            loanDetails,
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];

          await cancelOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              actionName: "Repay",
              batcherUtxo,
            },
            {
              validators,
              deployedValidators,
            }
          ).then(quickSubmitBuilder(emulator));
        });
      });

      describe("Batcher is profitable", () => {
        it("Profitable deposit Order", async () => {
          const txHash = await placeDepositOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              balanceToDeposit: 10_000_000n,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];

          lucid.selectWalletFromPrivateKey(BATCHER_ACCOUNT.privateKey);
          const currentBatcherBalance = await lucid.wallet.getUtxos();

          const orderTx = await executeOrder(
            "Deposit",
            lucid,
            lucid.newTx(),
            batcherUtxo,
            poolStakeValidator,
            collateralOracleValidator,
            loanOracleValidator,
            {
              validators,
              deployedValidators,
            },
            emulator.now(),
            0n
          );
          const tx = orderTx.txBuilder;
          await quickSubmitBuilder(emulator)({
            txBuilder: tx,
          });

          const isProfitable = isNewBalanceGreater(
            currentBatcherBalance,
            await lucid.wallet.getUtxos()
          );

          if (!isProfitable) {
            throw new Error("It was not profitable for the batcher");
          }
        });

        it("Profitable withdraw Order", async () => {
          const txHash = await placeWithdrawalOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              balanceToWithdraw: 2000000n,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = await lucid.utxosByOutRef([batcherOref]);
          lucid.selectWalletFromPrivateKey(BATCHER_ACCOUNT.privateKey);

          const currentBatcherBalance = await lucid.wallet.getUtxos();
          const orderTx = await executeOrder(
            "Withdraw",
            lucid,
            lucid.newTx(),
            batcherUtxo[0],
            poolStakeValidator,
            collateralOracleValidator,
            loanOracleValidator,
            {
              validators,
              deployedValidators,
            },
            emulator.now(),
            0n
          );

          const tx = orderTx.txBuilder;
          tx.collectFrom(await lucid.wallet.getUtxos());

          await quickSubmitBuilder(emulator)({
            txBuilder: tx,
          });

          const isProfitable = isNewBalanceGreater(
            currentBatcherBalance,
            await lucid.wallet.getUtxos()
          );

          expect(isProfitable).toBeTruthy();
        });

        it("Profitable borrow Order", async () => {
          const txHash = await placeBorrowOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const batcherOref: OutRef = {
            txHash,
            outputIndex: 0,
          };

          const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];
          const currentBatcherBalance = await lucid.wallet.getUtxos();

          const orderTx = await executeOrder(
            "Borrow",
            lucid,
            lucid.newTx(),
            batcherUtxo,
            poolStakeValidator,
            collateralOracleValidator,
            loanOracleValidator,
            {
              validators,
              deployedValidators,
            },
            emulator.now(),
            0n,
            loanOracle,
            collateralOracle
          );

          const tx = orderTx.txBuilder;
          tx.collectFrom(await lucid.wallet.getUtxos());

          await quickSubmitBuilder(emulator)({
            txBuilder: tx,
          });

          const isProfitable = isNewBalanceGreater(
            currentBatcherBalance,
            await lucid.wallet.getUtxos()
          );

          if (!isProfitable) {
            throw new Error("It was not profitable for the batcher");
          }
        });

        it("Profitable repay Order", async () => {
          let loanDetails: LoanDetails[] = [];
          const borrowOrderTxHash = await placeBorrowOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const borrowBatcherOref: OutRef = {
            txHash: borrowOrderTxHash,
            outputIndex: 0,
          };

          const borrowBatcherUtxo = (
            await lucid.utxosByOutRef([borrowBatcherOref])
          )[0];
          lucid.selectWalletFromPrivateKey(BATCHER_ACCOUNT.privateKey);

          const borrowResult = await executeOrder(
            "Borrow",
            lucid,
            lucid.newTx(),
            borrowBatcherUtxo,
            poolStakeValidator,
            collateralOracleValidator,
            loanOracleValidator,
            {
              validators,
              deployedValidators,
            },
            emulator.now(),
            0n,
            loanOracle,
            collateralOracle
          );

          const borrowTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResult.txBuilder,
          });

          const borrowOutput = 1;
          if (!borrowResult.borrowerTokenName) {
            throw new Error("Borrower token name not found");
          }

          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash, outputIndex: borrowOutput },
            poolTokenName: poolTokenName,
            borrowerTokenName: borrowResult.borrowerTokenName,
            poolStakeValidator: poolStakeValidator,
            loanOracleValidator: loanOracleValidator,
            collateralOracleValidator: collateralOracleValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
          });

          lucid.selectWalletFromPrivateKey(USER_ACCOUNT.privateKey);
          const repayTxHash = await placeRepayOrder(
            lucid,
            lucid.newTx(),
            emulator.now(),
            loanDetails,
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));

          const repaybatcherOref: OutRef = {
            txHash: repayTxHash,
            outputIndex: 0,
          };

          const repayBatcherUtxo = (
            await lucid.utxosByOutRef([repaybatcherOref])
          )[0];

          lucid.selectWalletFromPrivateKey(BATCHER_ACCOUNT.privateKey);
          const currentBatcherBalance = await lucid.wallet.getUtxos();
          const repayOrder = await executeOrder(
            "Repay",
            lucid,
            lucid.newTx(),
            repayBatcherUtxo,
            poolStakeValidator,
            collateralOracleValidator,
            loanOracleValidator,
            {
              validators,
              deployedValidators,
            },
            emulator.now(),
            0n
          );

          await quickSubmitBuilder(emulator)({
            txBuilder: repayOrder.txBuilder,
          });

          const isProfitable = isNewBalanceGreater(
            currentBatcherBalance,
            await lucid.wallet.getUtxos()
          );

          if (!isProfitable) {
            throw new Error("It was not profitable for the batcher");
          }
          expect(isProfitable).toBeTruthy();
        });
      });
    };

    runBatcherTestCommands();

    describe("updated config ", () => {
      beforeEach(async () => {
        await updateConfig(
          lucid,
          lucid.newTx(),
          {
            poolTokenName: poolTokenName,
            poolStakeValidator: poolStakeValidator,
          },
          { validators, deployedValidators }
        ).then(quickSubmitBuilder(emulator));
      });
      runBatcherTestCommands();
    });

    describe("Attempt to take some money ", () => {
      it("Valid Deposit Order", async () => {
        const txHash = await placeDepositOrder(
          lucid,
          lucid.newTx(),
          emulator.now(),
          {
            balanceToDeposit: 10_000_000n,
            poolTokenName,
          },
          { validators, deployedValidators }
        ).then(quickSubmitBuilder(emulator));

        const batcherOref: OutRef = {
          txHash,
          outputIndex: 0,
        };

        const batcherUtxo = (await lucid.utxosByOutRef([batcherOref]))[0];

        lucid.selectWalletFromPrivateKey(BATCHER_ACCOUNT.privateKey);

        await executeOrder(
          "Deposit",
          lucid,
          lucid.newTx(),
          batcherUtxo,
          poolStakeValidator,
          collateralOracleValidator,
          loanOracleValidator,
          {
            validators,
            deployedValidators,
          },
          emulator.now(),
          0n
        ).then(quickSubmitBuilder(emulator));
      });
    });
  });
}

testTokenScenario(
  "Loan: ADA; collateral: LENFI",
  {
    policy: "",
    name: "",
  },
  {
    policy: LENFI_POLICY_ID,
    name: LENFI_TOKEN_NAME,
  },
  4500000n, // Loan amount
  4500000n, // collateral amount
  undefined,
  await signedOracleFeed("lenfiAggregatedExpensive")
);

testTokenScenario(
  "Loan: LENFI; collateral: ADA",
  {
    policy: LENFI_POLICY_ID,
    name: LENFI_TOKEN_NAME,
  },
  {
    policy: "",
    name: "",
  },
  45000000n,
  45000000n,
  await signedOracleFeed("lenfiAggregatedCheap"),
  undefined
);

testTokenScenario(
  "Loan: MIN; collateral: LENFI",
  {
    policy: MIN_POLICY_ID,
    name: MIN_TOKEN_NAME,
  },
  {
    policy: LENFI_POLICY_ID,
    name: LENFI_TOKEN_NAME,
  },
  45000000n,
  45000000n,
  await signedOracleFeed("minAggregatedCheap"),
  await signedOracleFeed("lenfiAggregatedExpensive")
);

testTokenScenario(
  "Loan: MIN; collateral: LENFI (Pooled)",
  {
    policy: MIN_POLICY_ID,
    name: MIN_TOKEN_NAME,
  },
  {
    policy: LENFI_POLICY_ID,
    name: LENFI_TOKEN_NAME,
  },
  45000000n,
  45000000n,
  await signedOracleFeed("minAggregatedCheap"),
  await signedOracleFeed("lenfiPooledExpensive")
);
