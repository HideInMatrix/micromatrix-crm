/** Compare canonical serialized field values so equivalent dates, numbers and empty values match. */
export function hasSerializedFieldValueChanges(
  current: ReadonlyMap<string, string>,
  next: readonly { fieldId: string; serialized: string | null }[],
): boolean {
  return next.some((item) => (current.get(item.fieldId) ?? null) !== item.serialized)
}
