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
  return nodes.map((node) => {
    const approverType = node.approverType!
    const hierarchyType =
      approverType === 'DIRECT_LEADER' ||
      approverType === 'DEPT_LEADER' ||
      approverType === 'MULTIPLE_DIRECT_LEADER' ||
      approverType === 'MULTIPLE_DEPT_LEADER'
    return {
      name: node.name.trim(),
      approverType,
      approverIds:
        approverType === 'USER' || approverType === 'ROLE'
          ? [...new Set(node.approverIds ?? [])].sort()
          : hierarchyType
            ? [node.approverIds?.[0] ?? '1']
            : [],
      ccUserIds: [...new Set(node.ccUserIds ?? [])].sort(),
      mode: node.mode!,
      emptyApproverAction: node.emptyApproverAction ?? 'AUTO_PASS',
      fallbackApprover: node.fallbackApprover?.trim() || null,
      sameSubmitterAction: node.sameSubmitterAction ?? 'SKIP',
      approverDirection: node.approverDirection ?? 'BOTTOM_UP',
    }
  })
}

export function flowNodesEqual(
  left: NormalizableFlowNode[],
  right: NormalizableFlowNode[],
): boolean {
  return JSON.stringify(normalizeFlowNodes(left)) === JSON.stringify(normalizeFlowNodes(right))
}
