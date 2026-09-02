import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  FeePayerReadiness,
  type BalanceLookup,
} from "../src/readiness.js";

const DEVNET = "solana:devnet";
const MAINNET = "solana:mainnet";
const NETWORKS = [DEVNET, MAINNET];
const MIN_LAMPORTS = 10_000_000n;

function readiness(lookup: BalanceLookup): FeePayerReadiness {
  return new FeePayerReadiness(NETWORKS, lookup, MIN_LAMPORTS, 10);
}

describe("FeePayerReadiness", () => {
  test("no network is ready before the first refresh", () => {
    const monitor = readiness(async () => MIN_LAMPORTS);

    assert.deepEqual(monitor.readyNetworks(), []);
    assert.deepEqual(
      monitor.snapshot().map(({ network, ready, lamports, checkedAt, error }) => ({
        network,
        ready,
        lamports,
        checkedAt,
        error,
      })),
      NETWORKS.map((network) => ({
        network,
        ready: false,
        lamports: null,
        checkedAt: null,
        error: null,
      }))
    );
  });

  test("balances above and below the threshold set readiness", async () => {
    const monitor = readiness(async (network) =>
      network === DEVNET ? MIN_LAMPORTS + 1n : MIN_LAMPORTS - 1n
    );

    await monitor.refresh();

    assert.deepEqual(monitor.readyNetworks(), [DEVNET]);
    assert.equal(monitor.snapshot()[0]!.ready, true);
    assert.equal(monitor.snapshot()[1]!.ready, false);
  });

  test("the threshold is inclusive", async () => {
    const monitor = readiness(async () => MIN_LAMPORTS);

    await monitor.refresh();

    assert.deepEqual(monitor.readyNetworks(), NETWORKS);
  });

  test("an RPC error preserves a previous successful result", async () => {
    let fail = false;
    const monitor = readiness(async () => {
      if (fail) throw new Error("RPC unavailable");
      return MIN_LAMPORTS + 5n;
    });
    await monitor.refresh();
    const before = monitor.snapshot()[0]!;

    fail = true;
    await monitor.refresh();
    const after = monitor.snapshot()[0]!;

    assert.equal(after.ready, true);
    assert.equal(after.lamports, before.lamports);
    assert.equal(after.checkedAt, before.checkedAt);
    assert.equal(after.error, "RPC unavailable");
  });

  test("an RPC error without a successful result remains not ready", async () => {
    const monitor = readiness(async () => {
      throw new Error("first lookup failed");
    });

    await monitor.refresh();

    assert.deepEqual(monitor.readyNetworks(), []);
    assert.deepEqual(monitor.snapshot()[0], {
      network: DEVNET,
      ready: false,
      lamports: null,
      checkedAt: null,
      error: "first lookup failed",
    });
  });

  test("a successful lookup clears the previous error", async () => {
    let fail = true;
    const monitor = readiness(async () => {
      if (fail) throw new Error("temporary failure");
      return MIN_LAMPORTS;
    });
    await monitor.refresh();

    fail = false;
    await monitor.refresh();

    for (const state of monitor.snapshot()) {
      assert.equal(state.ready, true);
      assert.equal(state.error, null);
      assert.equal(state.lamports, MIN_LAMPORTS);
      assert.ok(state.checkedAt);
    }
  });

  test("a balance drop below the threshold removes readiness", async () => {
    let balance = MIN_LAMPORTS;
    const monitor = readiness(async () => balance);
    await monitor.refresh();
    assert.deepEqual(monitor.readyNetworks(), NETWORKS);

    balance = MIN_LAMPORTS - 1n;
    await monitor.refresh();

    assert.deepEqual(monitor.readyNetworks(), []);
    assert.ok(monitor.snapshot().every((state) => !state.ready));
  });

  test("a refresh started while one is running does not start a second", async () => {
    // The failure this guards against: a lookup slower than the interval lets
    // two runs overlap, and the older one finishes last and reinstates a
    // balance the newer run already superseded.
    let calls = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const monitor = readiness(async () => {
      calls += 1;
      await gate;
      return MIN_LAMPORTS;
    });

    const first = monitor.refresh();
    const second = monitor.refresh();

    assert.equal(calls, NETWORKS.length, "second refresh must reuse the first");
    release!();
    await Promise.all([first, second]);

    assert.equal(calls, NETWORKS.length);
    assert.deepEqual(monitor.readyNetworks(), NETWORKS);

    // Once the run settles, a later refresh is free to measure again.
    await monitor.refresh();
    assert.equal(calls, NETWORKS.length * 2);
  });

  test("a failure cannot resurrect a reading the same run replaced", async () => {
    let attempt = 0;
    const monitor = readiness(async (network) => {
      attempt += 1;
      if (network === MAINNET) throw new Error("rpc down");
      return MIN_LAMPORTS;
    });

    await monitor.refresh();

    assert.deepEqual(monitor.readyNetworks(), [DEVNET]);
    const mainnet = monitor.snapshot().find((s) => s.network === MAINNET)!;
    assert.equal(mainnet.ready, false);
    assert.equal(mainnet.lamports, null);
    assert.equal(mainnet.error, "rpc down");
    assert.ok(attempt >= NETWORKS.length);
  });

  test("stop is idempotent", () => {
    const monitor = readiness(async () => MIN_LAMPORTS);
    monitor.start();

    assert.doesNotThrow(() => {
      monitor.stop();
      monitor.stop();
    });
  });
});
