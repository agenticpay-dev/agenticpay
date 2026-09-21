/**
 * Nano (XNO) amount primitives for agenticpay.
 *
 * Nano's native unit is `raw`. One XNO = 10^30 raw, so arbitrary micro-call
 * prices ($0.0005 and below) never round — unlike a token with 6 or 9
 * decimals. Nothing here talks to the network; these are pure, deterministic
 * amount helpers that mirror `types.ts`/`usdc.ts` in the same package.
 *
 * CAIP-2 namespace/chain: `nano:mainnet` (see ChainAgnostic/namespaces).
 */

export type NanoNetwork = "mainnet" | "beta";

export interface XnoAmount {
  /** Amount in raw base units (1 XNO = 10^30 raw). */
  raw: bigint;
}

export const XNO_DECIMALS = 30;

/** One whole XNO in raw. */
export const XNO_RAW_PER_XNO = 10n ** 30n;

/**
 * Build an amount from a human XNO value. The value is exact up to 30
 * decimals; anything finer than a raw satoshi throws.
 */
export function xno(human: number | string): XnoAmount {
  const asString =
    typeof human === "number"
      ? Number.isInteger(human)
        ? human.toString()
        : String(human)
      : human;

  // Split on the decimal point; guard against exponent/sign forms we reject.
  const neg = asString.trim().startsWith("-");
  const body = asString.trim().replace(/^-/, "");
  const dotCount = body.split(".").length;
  if (dotCount > 2) {
    throw new Error(`Invalid XNO amount: ${human}`);
  }

  let [whole, frac] = body.split(".");
  if (whole === undefined) whole = "0";
  if (!/^[0-9]+$/.test(whole)) {
    throw new Error(`Invalid XNO amount: ${human}`);
  }
  if (frac === undefined) frac = "";
  if (frac !== "" && !/^[0-9]+$/.test(frac)) {
    throw new Error(`Invalid XNO amount: ${human}`);
  }
  if (frac.length > XNO_DECIMALS) {
    // A raw satoshi is the smallest unit; finer values cannot exist.
    throw new Error(
      `Invalid XNO amount: more than ${XNO_DECIMALS} decimals (${human})`
    );
  }

  const wholeRaw = BigInt(whole) * XNO_RAW_PER_XNO;
  const fracPad = frac.padEnd(XNO_DECIMALS, "0");
  const fracRaw = frac === "" ? 0n : BigInt(fracPad);
  const value = wholeRaw + fracRaw;
  return { raw: neg ? -value : value };
}

/**
 * Human-readable XNO string with up to 30 decimals, trailing zeros trimmed
 * (except a lone "0"). Mirrors the precision of `formatUsdc` but for raw.
 */
export function formatXno(amount: XnoAmount): string {
  const neg = amount.raw < 0n;
  const abs = neg ? -amount.raw : amount.raw;

  const whole = abs / XNO_RAW_PER_XNO;
  const frac = abs % XNO_RAW_PER_XNO;

  let fracStr = frac.toString().padStart(XNO_DECIMALS, "0");
  fracStr = fracStr.replace(/0+$/, "");

  const body = fracStr === "" ? whole.toString() : `${whole}.${fracStr}`;
  return neg ? `-${body}` : body;
}

/**
 * Compare two amounts for a strict fee-floor edge: `a` must cost strictly
 * less than `b`. Both are bigint, so this is exact — sub-cent prices never
 * collapse into each other at 6 vs 30 decimals.
 */
export function cheaperThan(a: XnoAmount, b: XnoAmount): boolean {
  return a.raw < b.raw;
}