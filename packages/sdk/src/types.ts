export type Cluster = "mainnet-beta" | "devnet";

export interface UsdcAmount {
  /** Amount in USDC base units (1 USDC = 1_000_000 base units, 6 decimals). */
  baseUnits: bigint;
}

export const USDC_DECIMALS = 6;

export function usdc(human: number | string): UsdcAmount {
  const asNumber = typeof human === "string" ? Number(human) : human;
  if (!Number.isFinite(asNumber)) {
    throw new Error(`Invalid USDC amount: ${human}`);
  }
  const scaled = Math.round(asNumber * 10 ** USDC_DECIMALS);
  return { baseUnits: BigInt(scaled) };
}

export function formatUsdc(amount: UsdcAmount): string {
  const whole = amount.baseUnits / 1_000_000n;
  const fractional = amount.baseUnits % 1_000_000n;
  return `${whole}.${fractional.toString().padStart(6, "0")}`;
}

export interface XnoAmount {
  /**
   * Amount in Nano raw (1 XNO = 10^30 raw). A 30-decimal unsigned integer,
   * represented as a bigint so a sub-cent price keeps its exact value when
   * summed across a billing run.
   */
  raw: bigint;
}

export const XNO_DECIMALS = 30;

/**
 * Nano raw units per whole XNO (10^30). Distinct from the 6-decimal base unit
 * of USDC: a $0.0005 per-call charge is exactly representable at 30 decimals
 * but rounds to zero base units in `UsdcAmount`.
 */
export const XNO_RAW_PER_XNO = 10n ** 30n;

/**
 * CAIP-2 chain id for the Nano mainnet ledger, as it appears in an x402
 * `accepts[]` entry (`network: "nano:mainnet", asset: "XNO"`).
 */
export const NANO_NETWORK = "nano:mainnet" as const;

/**
 * Build an `XnoAmount` from a human XNO string, exact down to a single raw unit.
 *
 * Decimal-string parsing (not float arithmetic) keeps `xno("0.0005").raw`
 * exactly `5e26` — a value float math would corrupt because 10^30 exceeds
 * `Number.MAX_SAFE_INTEGER`.
 */
export function xno(human: number | string): XnoAmount {
  const text = typeof human === "number" ? String(human) : human.trim();
  if (text === "" || !/^-?\d*\.?\d*$/.test(text)) {
    throw new Error(`Invalid XNO amount: ${human}`);
  }
  if (text.startsWith("-")) {
    throw new Error(`XNO amounts must be non-negative: ${human}`);
  }
  const [whole = "0", frac = ""] = text.split(".");
  if (frac.length > XNO_DECIMALS) {
    throw new Error(
      `XNO amount has more than ${XNO_DECIMALS} decimal places: ${human}`
    );
  }
  const raw = BigInt(whole) * XNO_RAW_PER_XNO + BigInt(frac.padEnd(XNO_DECIMALS, "0") || "0");
  return { raw };
}

/** Render an `XnoAmount` back to a trimmed human string. */
export function formatXno(amount: XnoAmount): string {
  const whole = amount.raw / XNO_RAW_PER_XNO;
  const frac = amount.raw % XNO_RAW_PER_XNO;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(XNO_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
