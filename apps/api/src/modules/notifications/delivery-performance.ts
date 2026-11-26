import { performance } from 'node:perf_hooks'

/** Opt-in attempt-local diagnostics. Never log identifiers, credentials or message content. */
export class DeliveryPerformance {
  private readonly start = performance.now()
  private readonly stages: Record<string, number> = {}
  channel = 'UNKNOWN'
  outcome = 'unclaimed'
  providerCode: number | null = null
  tokenSource: 'cache' | 'shared' | 'fetch' | null = null

  async measure<T>(stage: string, task: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try {
      return await task()
    } finally {
      this.stages[stage] = (this.stages[stage] ?? 0) + performance.now() - start
    }
  }

  finish(emit: (line: string) => void): void {
    const round = (n: number) => Math.round(n * 100) / 100
    emit(
      JSON.stringify({
        kind: 'message_delivery_perf',
        channel: this.channel,
        outcome: this.outcome,
        providerCode: this.providerCode,
        tokenSource: this.tokenSource,
        totalMs: round(performance.now() - this.start),
        stagesMs: Object.fromEntries(Object.entries(this.stages).map(([k, v]) => [k, round(v)])),
      }),
    )
  }
}

export function measureDelivery<T>(
  perf: DeliveryPerformance | undefined,
  stage: string,
  task: () => Promise<T>,
): Promise<T> {
  return perf ? perf.measure(stage, task) : task()
}
