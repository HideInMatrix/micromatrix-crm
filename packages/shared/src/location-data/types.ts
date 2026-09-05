export interface LocationOption {
  [key: string]: unknown
  label: string
  value: string
  children?: LocationOption[]
}
