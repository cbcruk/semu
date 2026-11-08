import type { FilingKind, RequirementResponse, TaxType } from '../tax.types.ts'
import type { RequirementRecord } from './filing.types.ts'
import type {
  PayrollLedgerSummary,
  RequirementCode,
  RequirementAnswer,
  RequirementAnswerResult,
  RequirementState,
  RequirementTemplate,
} from './filing-requirements.types.ts'

const 부가세체크리스트: ReadonlyArray<RequirementTemplate> = [
  { code: 'PG_ONLINE_SALES', autoLinked: false },
  { code: 'EXPORT_FX', autoLinked: false },
  { code: 'PAPER_TAX_INVOICE', autoLinked: false },
  { code: 'SIMPLE_RECEIPT', autoLinked: false },
  { code: 'ENDING_INVENTORY', autoLinked: false },
  { code: 'DEPOSIT_FUND_ACCOUNTS', autoLinked: false },
]

const 급여대장마감항목: RequirementTemplate = { code: 'PAYROLL_LEDGER_CLOSED', autoLinked: true }

const 원천세체크리스트: ReadonlyArray<RequirementTemplate> = [
  { code: 'BUSINESS_INCOME', autoLinked: false },
  { code: 'OTHER_INCOME', autoLinked: false },
  { code: 'DAILY_WAGE', autoLinked: false },
  { code: 'RETIREMENT_INCOME', autoLinked: false },
  { code: 'INTEREST_DIVIDEND', autoLinked: false },
  { code: 'UNREFLECTED_BONUS', autoLinked: false },
]

/**
 * 새 신고 건에 복사할 제출 자료 체크리스트입니다. 항목은 매뉴얼 `06-세무`의 별도 제출 자료 목록입니다.
 *
 * 예정고지 건과 법인세·종합소득세는 체크리스트가 없습니다. 급여대장 마감분은 급여 플랜 회사의 원천세에만 넣습니다.
 */
export function requirementTemplate(
  taxType: TaxType,
  kind: FilingKind,
  hasPayrollPlan: boolean,
): RequirementTemplate[] {
  if (kind === 'NOTICE') return []
  if (taxType === 'VAT') return [...부가세체크리스트]
  if (taxType === 'WITHHOLDING_TAX')
    return hasPayrollPlan ? [급여대장마감항목, ...원천세체크리스트] : [...원천세체크리스트]
  return []
}

/**
 * 고객이 고른 응답을 항목에 적용합니다.
 *
 * 파일이 붙은 항목에 `PENDING`을 고르면 `PROVIDED`로 둡니다. 파일이 붙은 채 `NOT_APPLICABLE`은 받지 않습니다.
 * 자동 연계 항목은 고칠 수 없습니다.
 */
export function answerRequirement(state: RequirementState, answer: RequirementAnswer): RequirementAnswerResult {
  if (state.autoLinked) return { ok: false, code: 'REQUIREMENT_AUTO_LINKED' }
  if (answer === 'NOT_APPLICABLE' && state.fileCount > 0) return { ok: false, code: 'REQUIREMENT_HAS_FILES' }
  return { ok: true, response: answer === 'PENDING' && state.fileCount > 0 ? 'PROVIDED' : answer }
}

/** 파일을 붙이거나 뗀 뒤의 응답입니다. 마지막 파일을 떼면 `PENDING`으로 돌아갑니다. */
export function responseAfterFiles(fileCount: number): RequirementResponse {
  return fileCount > 0 ? 'PROVIDED' : 'PENDING'
}

/**
 * 원천세 `PAYROLL_LEDGER_CLOSED` 항목의 응답입니다.
 *
 * 신고 기간에 지급한 급여대장이 하나 이상 있고 모두 마감됐으면 `PROVIDED`, 아니면 `PENDING`입니다.
 * 기간에 대장이 하나도 없어도 `PENDING`입니다.
 */
export function payrollLedgerResponse(summary: PayrollLedgerSummary): RequirementResponse {
  return summary.ledgerCount > 0 && summary.closedCount === summary.ledgerCount ? 'PROVIDED' : 'PENDING'
}

/** {@link relinkRequirements}가 다시 맞춘 체크리스트와 응답이 바뀐 항목입니다. */
export interface RelinkedRequirements {
  requirements: RequirementRecord[]
  changed: { code: RequirementCode; response: RequirementResponse }[]
}

/**
 * 자동 연계 항목(`autoLinked`)의 응답을 급여대장 마감 현황으로 다시 맞춥니다. 어느 항목이 자동 연계인지는 체크리스트를
 * 복사할 때 {@link requirementTemplate}이 정한 `autoLinked`로만 가립니다.
 *
 * 고객·대리인이 답한 항목은 그대로 둡니다. 응답이 같으면 항목도 그대로 두므로, 바뀐 항목이 없으면 `changed`가 비어 있습니다.
 */
export function relinkRequirements(
  requirements: ReadonlyArray<RequirementRecord>,
  summary: PayrollLedgerSummary,
  now: string,
): RelinkedRequirements {
  const 급여대장응답 = payrollLedgerResponse(summary)
  const 다시맞출항목 = requirements.filter(
    (requirement) => requirement.autoLinked && requirement.response !== 급여대장응답,
  )
  return {
    requirements: requirements.map((requirement) =>
      다시맞출항목.includes(requirement) ? { ...requirement, response: 급여대장응답, updatedAt: now } : requirement,
    ),
    changed: 다시맞출항목.map((requirement) => ({ code: requirement.code, response: 급여대장응답 })),
  }
}
