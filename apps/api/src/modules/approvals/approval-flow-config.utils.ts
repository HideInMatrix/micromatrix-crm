import type {
  ApprovalFlowNodeInput,
  ApprovalFormType as SharedApprovalFormType,
  ApprovalModule,
  ApprovalNodeConfig,
} from '@micromatrix/shared'
import { ApprovalFormType } from '../../generated/prisma/client'

export const FORM_TYPE_PREFIX: Record<SharedApprovalFormType, string> = {
  quotation: 'QTE-APV',
  contract: 'CTR-APV',
  invoice: 'INV-APV',
  order: 'ORD-APV',
}

export const FORM_TYPE_TO_MODULE: Partial<Record<SharedApprovalFormType, ApprovalModule>> = {
  quotation: 'quote',
  contract: 'contract',
  invoice: 'invoice',
  order: 'order',
}

export const MODULE_TO_FORM_TYPE: Partial<Record<ApprovalModule, SharedApprovalFormType>> = {
  quote: 'quotation',
  contract: 'contract',
  invoice: 'invoice',
  order: 'order',
}

export type NormalizableFlowNode = Omit<ApprovalFlowNodeInput, 'approverIds' | 'ccUserIds'> & {
  approverIds?: string[]
  ccUserIds?: string[]
}

export function toDbFormType(formType: SharedApprovalFormType): ApprovalFormType {
  const mapping: Record<SharedApprovalFormType, ApprovalFormType> = {
    quotation: ApprovalFormType.QUOTATION,
    contract: ApprovalFormType.CONTRACT,
    invoice: ApprovalFormType.INVOICE,
    order: ApprovalFormType.ORDER,
  }
  return mapping[formType]
}

export function fromDbFormType(formType: ApprovalFormType): SharedApprovalFormType | null {
  const mapping: Partial<Record<ApprovalFormType, SharedApprovalFormType>> = {
    [ApprovalFormType.QUOTATION]: 'quotation',
    [ApprovalFormType.CONTRACT]: 'contract',
    [ApprovalFormType.INVOICE]: 'invoice',
    [ApprovalFormType.ORDER]: 'order',
  }
  return mapping[formType] ?? null
}

export function normalizeFlowNodes(nodes: NormalizableFlowNode[]): ApprovalNodeConfig[] {
  return nodes.map((node) => ({
    name: node.name.trim(),
    approverType: node.approverType,
    approverIds:
      node.approverType === 'USER' || node.approverType === 'ROLE'
        ? [...new Set(node.approverIds ?? [])].sort()
        : [],
    ccUserIds: [...new Set(node.ccUserIds ?? [])].sort(),
    mode: node.mode,
  }))
}

export function flowNodesEqual(
  left: NormalizableFlowNode[],
  right: NormalizableFlowNode[],
): boolean {
  return JSON.stringify(normalizeFlowNodes(left)) === JSON.stringify(normalizeFlowNodes(right))
}
