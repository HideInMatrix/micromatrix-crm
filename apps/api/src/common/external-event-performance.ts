import { performance } from 'node:perf_hooks'

/** Opt-in, request-local timing. Never records identifiers, payloads or credentials. */
export class ExternalEventPerformance {
  private readonly startedAt: number
  private readonly stages: Record<string, number> = {}

  constructor(
    private readonly enabled = process.env.CRM_EXTERNAL_EVENT_PERF === '1',
    private readonly clock = () => performance.now(),
  ) {
    this.startedAt = enabled ? clock() : 0
  }

  measure<T>(stage: string, task: () => Promise<T>): Promise<T> {
    if (!this.enabled) return task()
    return this.measureEnabled(stage, task)
  }

  /** Record elapsed time until a callback boundary, e.g. transaction entry. */
  begin(stage: string): () => void {
    if (!this.enabled) return () => {}
    const start = this.clock()
    let ended = false
    return () => {
      if (ended) return
      ended = true
      this.stages[stage] = (this.stages[stage] ?? 0) + (this.clock() - start)
    }
  }

  private async measureEnabled<T>(stage: string, task: () => Promise<T>): Promise<T> {
    const end = this.begin(stage)
    try {
      return await task()
    } finally {
      end()
    }
  }

  finish(action: 'create' | 'convert', ok: boolean, emit: (line: string) => void): void {
    if (!this.enabled) return
    const total = this.clock() - this.startedAt
    // Log slow requests and failures only. Nested timings are not additive.
    if (ok && total < 250) return
    const round = (ms: number) => Math.round(ms * 100) / 100
    emit(
      JSON.stringify({
        kind: 'external_event_perf',
        action,
        ok,
        totalMs: round(total),
        stagesMs: Object.fromEntries(
          Object.entries(this.stages).map(([stage, ms]) => [stage, round(ms)]),
        ),
      }),
    )
  }
}
