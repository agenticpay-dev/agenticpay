export type BalanceLookup = (network: string) => Promise<bigint>;

export type NetworkReadiness = {
  network: string;
  ready: boolean;
  lamports: bigint | null;
  checkedAt: string | null;
  error: string | null;
};

const DEFAULT_INTERVAL_MS = 60_000;

export class FeePayerReadiness {
  private readonly states = new Map<string, NetworkReadiness>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    networks: string[],
    private readonly lookupBalance: BalanceLookup,
    private readonly minLamports: bigint,
    private readonly intervalMs = DEFAULT_INTERVAL_MS
  ) {
    for (const network of networks) {
      // Unknown capacity is withheld so the facilitator never advertises an
      // unmeasured network merely because it was configured.
      this.states.set(network, {
        network,
        ready: false,
        lamports: null,
        checkedAt: null,
        error: null,
      });
    }
  }

  /**
   * Refreshes every network, at most one run at a time.
   *
   * The interval is configurable and an RPC call has no guaranteed upper
   * bound, so runs could otherwise overlap and finish out of order: a slow
   * success from the previous round would then overwrite a fresh low-balance
   * reading and put a network back on the advertised list. Concurrent callers
   * share the run already in progress instead.
   */
  refresh(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.runRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runRefresh(): Promise<void> {
    await Promise.all(
      [...this.states.keys()].map(async (network) => {
        try {
          const lamports = await this.lookupBalance(network);
          this.states.set(network, {
            network,
            ready: lamports >= this.minLamports,
            lamports,
            checkedAt: new Date().toISOString(),
            error: null,
          });
        } catch (error) {
          // A transient RPC outage says nothing about current funds. Preserve
          // the last confirmed capacity until a successful lookup supersedes
          // it, reading that capacity now rather than before the await so a
          // failure cannot resurrect a reading this run already replaced.
          this.states.set(network, {
            ...this.states.get(network)!,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    );
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  readyNetworks(): string[] {
    return [...this.states.values()]
      .filter((state) => state.ready)
      .map((state) => state.network);
  }

  snapshot(): NetworkReadiness[] {
    return [...this.states.values()].map((state) => ({ ...state }));
  }
}
