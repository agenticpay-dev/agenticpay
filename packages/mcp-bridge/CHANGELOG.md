# Changelog

## 0.1.0

First release since `0.0.2` (2026-05-01). Everything below has been on `main`
for weeks or months but was never published, so anyone installing from npm has
been running the May build.

### Added

- **Spend caps.** The bridge signs payments without asking, so it can now be
  capped. `AGENTICPAY_BRIDGE_MAX_PER_CALL` refuses any single payment above a
  limit; `AGENTICPAY_BRIDGE_SESSION_BUDGET` refuses payments once the process's
  cumulative spend would exceed a limit. Programmatic equivalents:
  `maxPaymentPerCall` and `sessionBudget` in `BridgeConfig`. A refused payment
  surfaces as a tool error and the wallet is never touched.

  Budget is consumed when a payment is signed, not when it settles, so a
  settlement that later fails still counts against it. That is deliberate: the
  signature is the point of no return, and the alternative (refunding budget on
  failure) lets a peer that reliably fails settlement drain the wallet through
  repeated signing.

  Without these, `0.0.2` had no client-side limit on what an agent could spend.

### Changed

- `zod` `^3.23.8` to `^4.4.3`. **Breaking** for programmatic users who build
  `inputSchema` with zod 3 objects: zod 4 is a separate type identity, so
  schemas must be rebuilt with zod 4.
- `@solana/kit` `^5.5.0` to `^7.0.0`.
- `@x402/core`, `@x402/fetch`, `@x402/svm` `^2.11.0` to `^2.21.0`.
- `@modelcontextprotocol/sdk` `^1.29.0` to `^1.30.0`.

### Notes

The version number is bumped to `0.1.0` rather than `0.0.3` because two
dependency majors (zod, `@solana/kit`) cross a boundary that can break
programmatic callers, and because spend caps are a new capability rather than a
fix.
