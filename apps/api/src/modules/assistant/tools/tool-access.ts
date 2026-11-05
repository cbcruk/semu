import { hasPermission } from '../../identity-access/actor.ts'
import type { AllowedTool, AssistantTool, ToolAccessInput, ToolRequirement } from './assistant-tool.types.ts'

/**
 * 도구별 요건입니다 (`docs/reference/rules/assistant-tool-access.md`).
 *
 * 도구는 같은 일을 하는 일반 API와 같은 권한·플랜을 요구해서 비서가 권한 우회로가 되지 않게 합니다.
 * 플랜은 매뉴얼 기능표를 따릅니다. 세금계산서 발행은 무료 고객도 쓰고, 직원·급여 조회는 세무 기장이나 급여 플랜이면 됩니다.
 */
export const TOOL_REQUIREMENTS: Readonly<Record<AssistantTool, ToolRequirement>> = {
  KNOWLEDGE_QA: { plans: [], mode: 'READ' },
  FINANCE_SUMMARY: { permission: 'bank-transaction:read', plans: [], mode: 'READ' },
  ISSUE_TAX_INVOICE: { permission: 'tax-invoice:issue', plans: [], mode: 'CONFIRM' },
  REQUEST_CERTIFICATE: { permission: 'certificate-issuance:create', plans: ['TAXATION'], mode: 'CONFIRM' },
  LOOKUP_PAYROLL: { permission: 'payroll-ledger:read', plans: ['TAXATION', 'PAYROLL'], mode: 'READ' },
}

/** 도구를 보여 주는 순서입니다. */
export const ASSISTANT_TOOLS: ReadonlyArray<AssistantTool> = [
  'KNOWLEDGE_QA',
  'FINANCE_SUMMARY',
  'ISSUE_TAX_INVOICE',
  'REQUEST_CERTIFICATE',
  'LOOKUP_PAYROLL',
]

/**
 * 행위자가 쓸 수 있는 도구를 고릅니다. 비서 진입 자체는 `conversation:create` 권한으로 따로 판정합니다.
 *
 * @example 무료 고객의 관리자
 * ```ts
 * allowedTools({ permissions: new Set(['*']), plans: new Set() })
 * // KNOWLEDGE_QA, FINANCE_SUMMARY, ISSUE_TAX_INVOICE
 * ```
 */
export function allowedTools(access: ToolAccessInput): AllowedTool[] {
  return ASSISTANT_TOOLS.filter((tool) => {
    const requirement = TOOL_REQUIREMENTS[tool]
    const planOk = requirement.plans.length === 0 || requirement.plans.some((plan) => access.plans.has(plan))
    const permissionOk = requirement.permission === undefined || hasPermission(access, requirement.permission)
    return planOk && permissionOk
  }).map((tool) => ({ tool, mode: TOOL_REQUIREMENTS[tool].mode }))
}
