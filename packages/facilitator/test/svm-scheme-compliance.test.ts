/**
 * Compliance tests for the `exact` scheme on Solana, as specified in
 * coinbase/x402 `specs/schemes/exact/scheme_exact_svm.md`.
 *
 * The facilitator delegates verification to @x402/svm, so today these rules
 * hold because a dependency says so. We bump that dependency roughly weekly.
 * These tests turn "the library presumably still checks this" into something
 * the build proves, and they fail loudly if an upgrade ever relaxes a rule
 * that protects the fee payer's own funds.
 *
 * Every case asserts the *specific* invalidReason, not merely that the payment
 * was rejected. A test that only asserts rejection passes for the wrong reason
 * as soon as the fixture drifts, and then quietly stops testing anything.
 *
 * The control for that is `reaches simulation`: the unmodified fixture must get
 * all the way to on-chain simulation, which only happens once every structural
 * check has passed. If that test fails, the other cases prove nothing, because
 * a transaction rejected before the rule under test is not evidence about that
 * rule.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { ExactSvmScheme } from "@x402/svm/exact/facilitator";

const NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const OTHER_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const OTHER_MINT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const PAY_TO = address("3rHoEumCpH8EGrr6Lq2vBKeyec6h3yPRGj2nGG2FzEfX");
const SOURCE_ATA = address("2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4");
const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const AMOUNT = 1000n;
const BLOCKHASH = {
  blockhash: blockhash("11111111111111111111111111111111"),
  lastValidBlockHeight: 100n,
} as const;

/** Fixed seeds so a failure is reproducible rather than a new address each run. */
const seed = (n: number) =>
  new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * n + 1) % 256));

const payerSigner = await createKeyPairSignerFromPrivateKeyBytes(seed(7));
const feePayerSigner = await createKeyPairSignerFromPrivateKeyBytes(seed(11));
const strangerSigner = await createKeyPairSignerFromPrivateKeyBytes(seed(13));

const [DEST_ATA] = await findAssociatedTokenPda({
  owner: PAY_TO,
  mint: MINT,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});

/**
 * Stand-in for the facilitator's signer. Verification only calls getAddresses()
 * to decide whether it manages the fee payer; the throwing simulate is what
 * lets a test observe that a transaction survived every structural check.
 */
const SIMULATION_REACHED = "simulation reached";
const facilitatorSigner = {
  getAddresses: () => [feePayerSigner.address],
  // Verification co-signs before simulating, both inside one try block, so the
  // signing step has to succeed for simulation to be observable at all.
  signTransaction: async (transaction: string) => transaction,
  simulateTransaction: async () => {
    throw new Error(SIMULATION_REACHED);
  },
  sendTransaction: async () => {
    throw new Error("settlement must never run during verification");
  },
};

/** A memo instruction, hand-built because there is no @solana-program/memo here. */
const memoInstruction = (text: string): Instruction => ({
  programAddress: MEMO_PROGRAM,
  accounts: [],
  data: new TextEncoder().encode(text),
});

type Overrides = {
  instructions?: Instruction[];
  feePayer?: Address;
};

/** The spec-compliant transaction every case starts from, base64 wire encoded. */
async function buildTransaction(over: Overrides = {}): Promise<string> {
  const instructions = over.instructions ?? [
    getSetComputeUnitLimitInstruction({ units: 200_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1_000 }),
    getTransferCheckedInstruction(
      {
        source: SOURCE_ATA,
        mint: MINT,
        destination: DEST_ATA,
        authority: payerSigner,
        amount: AMOUNT,
        decimals: 6,
      },
      { programAddress: TOKEN_PROGRAM_ADDRESS },
    ),
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(over.feePayer ?? feePayerSigner.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(BLOCKHASH, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getBase64EncodedWireTransaction(
    await partiallySignTransactionMessageWithSigners(message),
  );
}

const transferTo = (over: Record<string, unknown> = {}) =>
  getTransferCheckedInstruction(
    {
      source: SOURCE_ATA,
      mint: MINT,
      destination: DEST_ATA,
      authority: payerSigner,
      amount: AMOUNT,
      decimals: 6,
      ...over,
    } as Parameters<typeof getTransferCheckedInstruction>[0],
    { programAddress: TOKEN_PROGRAM_ADDRESS },
  );

const computeBudget = () => [
  getSetComputeUnitLimitInstruction({ units: 200_000 }),
  getSetComputeUnitPriceInstruction({ microLamports: 1_000 }),
];

/* eslint-disable @typescript-eslint/no-explicit-any */
const requirements = (over: Record<string, unknown> = {}) =>
  ({
    scheme: "exact",
    network: NETWORK,
    asset: MINT,
    payTo: PAY_TO,
    amount: AMOUNT.toString(),
    maxTimeoutSeconds: 60,
    extra: { feePayer: feePayerSigner.address },
    ...over,
  }) as any;

const payloadFor = (transaction: string, over: Record<string, unknown> = {}) =>
  ({
    x402Version: 2,
    accepted: { scheme: "exact", network: NETWORK, ...over },
    payload: { transaction },
  }) as any;

async function verify(payload: any, reqs: any) {
  const scheme = new ExactSvmScheme(facilitatorSigner as any);
  return scheme.verify(payload, reqs);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("exact/SVM scheme compliance", () => {
  test("control: an unmodified payment reaches simulation", async () => {
    const result = await verify(payloadFor(await buildTransaction()), requirements());
    // Simulation is the last step, so getting there means every structural rule
    // passed. Without this, a rejection in the cases below could come from a
    // broken fixture rather than from the rule being tested.
    assert.equal(result.invalidReason, "transaction_simulation_failed");
    assert.equal(result.invalidMessage, SIMULATION_REACHED);
    assert.equal(result.payer, payerSigner.address);
  });

  describe("fee payer safety (the facilitator must not fund the payment)", () => {
    test("rejects the fee payer acting as the transfer authority", async () => {
      const transaction = await buildTransaction({
        instructions: [...computeBudget(), transferTo({ authority: feePayerSigner })],
      });
      const result = await verify(payloadFor(transaction), requirements());
      assert.equal(
        result.invalidReason,
        "invalid_exact_svm_payload_transaction_fee_payer_transferring_funds",
      );
    });

    // GAP vs the spec, deliberately recorded rather than asserted as passing.
    //
    // scheme_exact_svm.md requires three separate checks: the fee payer must not
    // be the transfer `authority`, must not be the `source` of the funds, and
    // must not appear in the `accounts` of *any* instruction. @x402/svm 2.21.0
    // implements only the first (one `signerAddresses.includes(authorityAddress)`
    // test); there is no check on `source` or on the wider account list.
    //
    // In the ordinary case the authority check is enough, because funds cannot
    // leave a token account without its owner authorising the transfer. It stops
    // being enough if the fee payer's own token account has an SPL delegate: the
    // delegate signs as authority, the source is still the fee payer's account,
    // and the authority check passes.
    //
    // Asserting a rejection here would make the suite red over a dependency's
    // behaviour we do not control. Asserting the current behaviour as correct
    // would quietly bless the gap. So the case documents it and pins what the
    // library actually does today, which is what a future upgrade would change.
    test("documents that only the transfer authority is checked, not the source", async () => {
      const [feePayerAta] = await findAssociatedTokenPda({
        owner: feePayerSigner.address,
        mint: MINT,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const transaction = await buildTransaction({
        instructions: [...computeBudget(), transferTo({ source: feePayerAta })],
      });
      const result = await verify(payloadFor(transaction), requirements());
      assert.equal(
        result.invalidReason,
        "transaction_simulation_failed",
        "if this ever becomes a structural rejection, the library started checking " +
          "the source and this test should assert the rejection instead",
      );
    });

    test("rejects a fee payer this facilitator does not control", async () => {
      const transaction = await buildTransaction({ feePayer: strangerSigner.address });
      const result = await verify(
        payloadFor(transaction),
        requirements({ extra: { feePayer: strangerSigner.address } }),
      );
      assert.equal(result.invalidReason, "fee_payer_not_managed_by_facilitator");
    });

    test("rejects requirements with no fee payer at all", async () => {
      const result = await verify(
        payloadFor(await buildTransaction()),
        requirements({ extra: {} }),
      );
      assert.equal(result.invalidReason, "invalid_exact_svm_payload_missing_fee_payer");
    });
  });

  describe("instruction layout", () => {
    test("rejects fewer than three instructions", async () => {
      const transaction = await buildTransaction({ instructions: computeBudget() });
      const result = await verify(payloadFor(transaction), requirements());
      assert.equal(
        result.invalidReason,
        "invalid_exact_svm_payload_transaction_instructions_length",
      );
    });

    // The spec caps the layout at 6 instructions; @x402/svm 2.21.0 admits 7
    // (`length < 3 || length > 7`). Seven is what we actually run, so that is
    // what the boundary is pinned to, with the discrepancy noted rather than
    // hidden. The cap matters either way: it bounds how much unrelated activity
    // can ride along in a transaction the facilitator co-signs.
    test("accepts the library's upper bound of seven instructions", async () => {
      const transaction = await buildTransaction({
        instructions: [
          ...computeBudget(),
          transferTo(),
          memoInstruction("a"),
          memoInstruction("b"),
          memoInstruction("c"),
          memoInstruction("d"),
        ],
      });
      const result = await verify(payloadFor(transaction), requirements());
      assert.equal(result.invalidReason, "transaction_simulation_failed");
    });

    test("rejects more instructions than the layout allows", async () => {
      const transaction = await buildTransaction({
        instructions: [
          ...computeBudget(),
          transferTo(),
          memoInstruction("a"),
          memoInstruction("b"),
          memoInstruction("c"),
          memoInstruction("d"),
          memoInstruction("e"),
        ],
      });
      const result = await verify(payloadFor(transaction), requirements());
      assert.equal(
        result.invalidReason,
        "invalid_exact_svm_payload_transaction_instructions_length",
      );
    });

    test("rejects a transaction carrying no transfer at all", async () => {
      const transaction = await buildTransaction({
        instructions: [...computeBudget(), memoInstruction("no transfer here")],
      });
      const result = await verify(payloadFor(transaction), requirements());
      assert.equal(
        result.invalidReason,
        "invalid_exact_svm_payload_no_transfer_instruction",
      );
    });
  });

  describe("payment terms must match what was advertised", () => {
    test("rejects a different token than the one billed", async () => {
      const transaction = await buildTransaction({
        instructions: [...computeBudget(), transferTo({ mint: OTHER_MINT })],
      });
      const result = await verify(payloadFor(transaction), requirements());
      assert.equal(result.invalidReason, "invalid_exact_svm_payload_mint_mismatch");
    });

    test("rejects a destination that is not the payee's token account", async () => {
      const [strangerAta] = await findAssociatedTokenPda({
        owner: strangerSigner.address,
        mint: MINT,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const transaction = await buildTransaction({
        instructions: [...computeBudget(), transferTo({ destination: strangerAta })],
      });
      const result = await verify(payloadFor(transaction), requirements());
      assert.equal(result.invalidReason, "invalid_exact_svm_payload_recipient_mismatch");
    });

    test("rejects paying less than the amount required", async () => {
      const transaction = await buildTransaction({
        instructions: [...computeBudget(), transferTo({ amount: AMOUNT - 1n })],
      });
      const result = await verify(payloadFor(transaction), requirements());
      assert.equal(result.invalidReason, "invalid_exact_svm_payload_amount_mismatch");
    });

    test("rejects paying more than the amount required", async () => {
      // Overpaying is rejected too: `exact` means exact, and a facilitator that
      // tolerated it would let a payer inflate an on-chain record of a purchase
      // the seller never priced that way.
      const transaction = await buildTransaction({
        instructions: [...computeBudget(), transferTo({ amount: AMOUNT + 1n })],
      });
      const result = await verify(payloadFor(transaction), requirements());
      assert.equal(result.invalidReason, "invalid_exact_svm_payload_amount_mismatch");
    });

    test("rejects a payload for a different network", async () => {
      const result = await verify(
        payloadFor(await buildTransaction(), { network: OTHER_NETWORK }),
        requirements(),
      );
      assert.equal(result.invalidReason, "network_mismatch");
    });

    test("rejects a scheme other than exact", async () => {
      const result = await verify(
        payloadFor(await buildTransaction(), { scheme: "upto" }),
        requirements(),
      );
      assert.equal(result.invalidReason, "unsupported_scheme");
    });
  });

  describe("seller-supplied memo", () => {
    test("accepts the memo the seller asked for", async () => {
      const transaction = await buildTransaction({
        instructions: [...computeBudget(), transferTo(), memoInstruction("invoice-42")],
      });
      const result = await verify(
        payloadFor(transaction),
        requirements({ extra: { feePayer: feePayerSigner.address, memo: "invoice-42" } }),
      );
      assert.equal(result.invalidReason, "transaction_simulation_failed");
    });

    test("rejects a memo whose contents were tampered with", async () => {
      const transaction = await buildTransaction({
        instructions: [...computeBudget(), transferTo(), memoInstruction("invoice-99")],
      });
      const result = await verify(
        payloadFor(transaction),
        requirements({ extra: { feePayer: feePayerSigner.address, memo: "invoice-42" } }),
      );
      assert.equal(result.invalidReason, "invalid_exact_svm_payload_memo_mismatch");
    });

    test("rejects a missing memo when the seller required one", async () => {
      const result = await verify(
        payloadFor(await buildTransaction()),
        requirements({ extra: { feePayer: feePayerSigner.address, memo: "invoice-42" } }),
      );
      assert.equal(result.invalidReason, "invalid_exact_svm_payload_memo_count");
    });
  });

  test("rejects a payload that is not a decodable transaction", async () => {
    const result = await verify(payloadFor("bm90LWEtdHJhbnNhY3Rpb24="), requirements());
    assert.equal(
      result.invalidReason,
      "invalid_exact_svm_payload_transaction_could_not_be_decoded",
    );
  });
});
