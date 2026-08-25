export interface DirectPoolPickRule {
  limitOnNumber: boolean
  pickNumber: number | null
  limitPreOwner: boolean
  pickIntervalDays: number | null
  limitNew: boolean
  newPickInterval: number | null
}

export interface DirectOwnerHistory {
  owner: string
  collectionTime: bigint
  endTime: bigint
}

export interface CapacityExclusionCondition {
  column: 'stage'
  operator: 'IN' | 'NOT_IN'
  value: string[]
}

export interface DirectPoolConfigurationInput {
  name: string
  scopeIds: string[]
  ownerIds: string[]
  enable: boolean
  auto: boolean
  hiddenFieldIds: string[]
  pickRule: DirectPoolPickRule
  recycleRule: {
    operator: 'AND' | 'OR'
    condition: string | null
  }
}

export interface DirectCapacityConfigurationInput {
  scopeIds: string[]
  capacity: number | null
}

export type PoolOwnershipOperation = 'PICK' | 'ASSIGN' | 'TRANSFER' | 'MOVE_TO_POOL' | 'RECYCLE'

export interface ClaimRuleContext {
  rule: DirectPoolPickRule | null
  claimantId: string
  processCount: number
  todayPickedCount: number
  previousOwner: DirectOwnerHistory | null
  poolEnteredAt: bigint
  capacity: number | null
  ownedCount: number
  excludedOwnedCount?: number
  poolAdmin: boolean
  /** Cordys Clue 与 Customer 源码在这一点存在差异。 */
  poolAdminStillChecksPreviousOwner: boolean
  now: bigint
}
