import { createLegacyId32 } from '../../common/legacy-id'
import type { PrismaClient } from '../../prisma/db.js'

type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

export type LeadStageEventSource = 'MANUAL' | 'IMPORT' | 'RULE' | 'EXTERNAL' | 'SYSTEM'

export async function recordLeadStageEvent(
  tx: PrismaTransaction,
  input: {
    organizationId: string
    leadId: string
    fromStageKey: string | null
    toStageKey: string
    occurredAt: bigint
    operatorId: string
    ownerId: string | null
    source: LeadStageEventSource
  },
) {
  await tx.orm.public.LeadStageEvent.create({
    id: createLegacyId32(),
    organizationId: input.organizationId,
    leadId: input.leadId,
    fromStageKey: input.fromStageKey,
    toStageKey: input.toStageKey,
    occurredAt: input.occurredAt,
    operatorId: input.operatorId,
    ownerId: input.ownerId,
    source: input.source,
  })
}
