export type MobileViewSelection =
  | { type: 'default' }
  | { type: 'system'; id: string }
  | { type: 'saved'; id: string }

