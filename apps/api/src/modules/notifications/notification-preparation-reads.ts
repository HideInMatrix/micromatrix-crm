/** Short-lived read reuse for one bounded outbox preparation group.
 * Never retained across groups or used for provider credentials or rendered payloads.
 */
export class NotificationPreparationReads {
  private readonly pending = new Map<string, Promise<unknown>>()

  read<T>(key: readonly string[], load: () => Promise<T>): Promise<T> {
    const encoded = JSON.stringify(key)
    const existing = this.pending.get(encoded)
    if (existing) return existing as Promise<T>
    const result = Promise.resolve().then(load)
    this.pending.set(encoded, result)
    void result.catch(() => {
      if (this.pending.get(encoded) === result) this.pending.delete(encoded)
    })
    return result
  }
}
