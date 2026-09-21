/**
 * Tests for the Nano (XNO) amount primitives added to this SDK.
 *
 * The point of these primitives is the fee floor: a $0.0005 micro-call settles
 * exactly in Nano's 30-decimal raw unit, where a 6-decimal token rounds the
 * same charge to zero at the same price. Several cases pin that edge so a
 * later decimal-shrinking "simplification" cannot silently reintroduce it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  xno,
  formatXno,
  cheaperThan,
  XNO_DECIMALS,
  XNO_RAW_PER_XNO,
} from "../src/nano.js";

describe("xno / amount construction", () => {
  test("zero is zero", () => {
    assert.equal(xno(0).raw, 0n);
    assert.equal(xno("0").raw, 0n);
    assert.equal(formatXno(xno(0)), "0");
  });

  test("whole XNO are exact multiples of one raw", () => {
    assert.equal(xno(1).raw, 10n ** 30n);
    assert.equal(formatXno(xno("1.5")), "1.5");
  });

  test("sub-cent prices survive the decimal floor (the fee-floor edge)", () => {
    // $0.0005 XNO is 0.0005 * 10^30 raw — representable exactly; a 6-decimal
    // token would round it to 0.
    const halfMilli = xno("0.0005");
    assert.equal(halfMilli.raw, 5n * 10n ** 26n);
    assert.equal(formatXno(halfMilli), "0.0005");
  });

  test("a single raw is the smallest unit and formats back", () => {
    const oneRaw = { raw: 1n };
    assert.equal(formatXno(oneRaw), `0.${"0".repeat(29)}1`);
    assert.equal(xno(`0.${"0".repeat(29)}1`).raw, 1n);
  });

  test("negative values round-trip", () => {
    assert.equal(formatXno(xno("-0.0005")), "-0.0005");
    assert.equal(xno("-0.0005").raw, -5n * 10n ** 26n);
  });

  test("string and number inputs agree", () => {
    assert.equal(xno("0.0005").raw, xno(0.0005).raw);
  });

  test("trailing zeros are trimmed but accuracy is preserved", () => {
    const a = xno("0.000500");
    assert.equal(formatXno(a), "0.0005");
    assert.equal(a.raw, xno("0.0005").raw);
  });
});

describe("invalid inputs are rejected", () => {
  const bad = [
    "",
    "abc",
    "1.2.3",
    "1e6",
    "xno",
    "..",
    ".",
    "1_000",
    "0x1",
  ];
  for (const s of bad) {
    test(`rejects ${JSON.stringify(s)}`, () => {
      assert.throws(() => xno(s));
    });
  }

  test("rejects finer-than-raw precision", () => {
    const tooFine = `0.${"0".repeat(30)}1`;
    assert.throws(() => xno(tooFine));
  });

  test("rejects non-finite numbers", () => {
    assert.throws(() => xno(Number.NaN));
    assert.throws(() => xno(Number.POSITIVE_INFINITY));
  });
});

describe("cheaperThan (strict fee-floor comparison)", () => {
  test("a smaller raw amount is strictly cheaper", () => {
    assert.equal(cheaperThan(xno("0.0001"), xno("0.0005")), true);
    assert.equal(cheaperThan(xno("0.0005"), xno("0.0005")), false);
    assert.equal(cheaperThan(xno("0.001"), xno("0.0005")), false);
  });

  test("negative is cheaper than positive", () => {
    assert.equal(cheaperThan(xno("-1"), xno("1")), true);
  });
});

describe("constants match Nano's unit", () => {
  test("one XNO is 10^30 raw", () => {
    assert.equal(XNO_RAW_PER_XNO, 10n ** 30n);
  });
  test("decimals constant is 30", () => {
    assert.equal(XNO_DECIMALS, 30);
  });
});
