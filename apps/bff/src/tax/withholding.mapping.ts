import { LegacyError, legacyErrors } from '../legacy-error.ts'
import { snakeCase } from '../keys.ts'
import type { LedgerWithRows } from '../payroll/ledgers.mapping.ts'
import type {
  Filing,
  FilingHistoryEntry,
  FilingStatus,
  FilingSummary,
  PayrollIncomeType,
  PayrollLedger,
} from '../upstream.types.ts'

/**
 * 새 신고 건(`/v1/filings`)과 현행 원천세 화면(`/api/company/:companyId/tax/withholding-tax/…`)의 형태 번역입니다.
 * 현행 형태는 현행 서버(`apps/api/legacy/src/modules/filings/filings.serializer.ts`)를 따릅니다.
 */

/** 현행 신고 건 상태입니다. 새 `CANCELED`는 현행 철자 `cancelled`입니다. */
export type LegacyFilingStatus =
  | 'scheduled'
  | 'requested'
  | 'submitted'
  | 'reviewing'
  | 'ledger_pending'
  | 'preparing'
  | 'filed'
  | 'settled'
  | 'cancelled'

/** 새 상태 → 현행 상태입니다. */
export function legacyFilingStatus(status: FilingStatus): LegacyFilingStatus {
  return status === 'CANCELED' ? 'cancelled' : (status.toLowerCase() as LegacyFilingStatus)
}

/** 부가세 밖 세목의 현행 진행 단계 이름입니다(현행 `PROCESS_STEPS.default`). */
const STEPS = ['자료 제출 가능', '자료 검토중', '작업중', '납부', '마감'] as const

/** 상태 → 현행 단계 위치(1부터)입니다. 예정·취소는 단계가 없어 0입니다. */
const STEP_INDEX: Partial<Record<FilingStatus, number>> = {
  REQUESTED: 1,
  SUBMITTED: 2,
  REVIEWING: 2,
  PREPARING: 3,
  FILED: 4,
  SETTLED: 5,
}

/**
 * 현행 `tax_period_key`입니다. 매월 원천세는 `2026-10-payment`, 반기는 `2026-H2-semiannual`이었습니다.
 * 원천세에 없는 종류는 새 기간 키를 그대로 씁니다.
 */
export function legacyPeriodKey(filing: Pick<FilingSummary, 'kind' | 'periodKey'>): string {
  if (filing.kind === 'MONTHLY') return `${filing.periodKey}-payment`
  if (filing.kind === 'SEMIANNUAL') return `${filing.periodKey}-semiannual`
  return filing.periodKey
}

/** 현행 `year`·`quarter`입니다. 매월은 그 달의 분기, 반기는 상반기 2·하반기 4였습니다. */
function yearAndQuarter(filing: FilingSummary): { year: number; quarter: number | null } {
  const year = Number(filing.periodStart.slice(0, 4))
  const month = Number(filing.periodStart.slice(5, 7))
  if (filing.kind === 'MONTHLY') return { year, quarter: Math.ceil(month / 3) }
  if (filing.kind === 'SEMIANNUAL') return { year, quarter: month <= 6 ? 2 : 4 }
  return { year, quarter: null }
}

/** 현행 목록 항목(`serializeFiling`)입니다. 원천세에는 부가세의 현행 리포트 필드(`process_step` 등)가 없었습니다. */
export function toLegacyFiling(filing: FilingSummary): Record<string, unknown> {
  const index = STEP_INDEX[filing.status] ?? 0
  return {
    id: filing.id,
    tax_type: filing.taxType === 'WITHHOLDING_TAX' ? 'withholding_tax' : filing.taxType.toLowerCase(),
    kind: filing.kind.toLowerCase(),
    tax_period_key: legacyPeriodKey(filing),
    revision: filing.revision,
    ...yearAndQuarter(filing),
    period_start: filing.periodStart,
    period_end: filing.periodEnd,
    statutory_due: filing.statutoryDue,
    due_date: filing.dueDate,
    payment_due: filing.paymentDue,
    submit_due: filing.submitDue,
    status: legacyFilingStatus(filing.status),
    is_overdue: filing.isOverdue,
    step: index > 0 ? (STEPS[index - 1] ?? null) : null,
    step_index: index,
    step_count: STEPS.length,
    payable_amount: filing.payableAmount,
    settlement: filing.settlement === null ? null : filing.settlement.toLowerCase(),
    paid_on: filing.paidOn,
    ledger_dispute_count: filing.ledgerDisputeCount,
    version: filing.version,
    updated_at: filing.updatedAt,
  }
}

/** 현행 원천세 제출 자료 항목의 이름입니다. 새 API는 이름을 주지 않으므로(클라이언트가 고름) 현행 문구를 BFF가 붙입니다. */
export const REQUIREMENT_LABELS: Readonly<Record<string, string>> = {
  payroll_ledger_closed: '급여대장 마감분',
  business_income: '사업소득(프리랜서·용역비) 지급 내역',
  other_income: '기타소득 지급 내역',
  daily_wage: '일용직 근로소득 지급 내역',
  retirement_income: '퇴직소득 지급 내역',
  interest_dividend: '이자·배당소득 등 지급 내역',
  unreflected_bonus: '급여에 반영되지 않은 상여·수당 지급 내역',
}

/** 현행 항목 코드(소문자)를 새 코드로 바꿉니다. 원천세 항목이 아니면 `undefined`입니다. */
export function requirementCodeOf(legacy: string): string | undefined {
  return Object.hasOwn(REQUIREMENT_LABELS, legacy) ? legacy.toUpperCase() : undefined
}

/** 현행 고객 화면에 보이는 문서인지입니다. 매입매출장은 확인 단계부터, 신고서·납부서·고지서는 신고 뒤부터였습니다. */
function visibleToClient(document: Filing['documents'][number], status: FilingStatus): boolean {
  if (document.replacedAt !== null) return false
  if (document.type === 'LEDGER') return ['LEDGER_PENDING', 'PREPARING', 'FILED', 'SETTLED'].includes(status)
  return status === 'FILED' || status === 'SETTLED'
}

/** 새 커맨드 → 현행 전이 이름입니다. 현행 이력의 `type`이었습니다. */
const LEGACY_TRANSITION: Readonly<Record<string, string>> = {
  REQUEST: 'request',
  SUBMIT: 'submit',
  UNSUBMIT: 'unsubmit',
  START_REVIEW: 'startReview',
  REJECT: 'reject',
  UPLOAD_LEDGER: 'uploadLedger',
  CONFIRM_LEDGER: 'confirmLedger',
  DISPUTE_LEDGER: 'disputeLedger',
  START_PREPARING: 'startPreparing',
  FILE: 'file',
  RECORD_NOTICE: 'recordNotice',
  PAY: 'pay',
  CLOSE: 'close',
  CANCEL: 'cancel',
}

/** 새 이력 종류 → 현행 이력 종류입니다. 현행에 없던 종류(`REQUIREMENT_LINKED` 등)는 소문자로 냅니다. */
function legacyEventType(type: string): string {
  if (type === 'DOCUMENT_ADDED') return 'document_uploaded'
  return LEGACY_TRANSITION[type] ?? type.toLowerCase()
}

/**
 * 이력 `detail` → 현행 `payload`입니다. 키는 snake_case, 항목 코드·응답은 현행 소문자입니다. 비었으면 `null`입니다.
 * 문서 추가(`DOCUMENT_ADDED`)의 `type`은 현행 `document_uploaded`의 `doc_type`(소문자)입니다.
 */
function legacyPayload(type: string, detail: Record<string, string | number>): Record<string, unknown> | null {
  const entries = Object.entries(detail)
  if (entries.length === 0) return null
  return Object.fromEntries(
    entries.map(([key, value]) => {
      if (type === 'DOCUMENT_ADDED' && key === 'type') return ['doc_type', String(value).toLowerCase()]
      return [
        snakeCase(key),
        (key === 'code' || key === 'response') && typeof value === 'string' ? value.toLowerCase() : value,
      ]
    }),
  )
}

/**
 * 현행 상세(`serializeFilingDetail`, 고객 시점)입니다.
 *
 * - 현행 고객 경로는 행위자와 상관없이 고객 시점으로 문서를 걸렀으므로, 대리인이 이 경로로 읽어도 바뀐 문서와 아직 보이지 않는 문서를 뺍니다
 * - 파일·문서의 이름·형식·크기는 새 API가 파일 ID만 가지므로 `null`입니다(파일 저장소가 아직 없음)
 */
export function toLegacyFilingDetail(filing: Filing, history: readonly FilingHistoryEntry[]): Record<string, unknown> {
  return {
    ...toLegacyFiling(filing),
    requirements: filing.requirements.map((requirement) => {
      const code = requirement.code.toLowerCase()
      return {
        code,
        label: REQUIREMENT_LABELS[code] ?? null,
        response: requirement.response.toLowerCase(),
        auto_linked: requirement.autoLinked,
        linked_status: requirement.autoLinked ? (requirement.response === 'PROVIDED' ? 'closed' : 'open') : null,
        note: requirement.note,
        updated_at: requirement.updatedAt,
        files: requirement.fileIds.map((id) => ({
          id,
          original_name: null,
          mime_type: null,
          size_bytes: null,
          created_at: null,
        })),
      }
    }),
    documents: filing.documents
      .filter((document) => visibleToClient(document, filing.status))
      .map((document) => ({
        id: document.id,
        doc_type: document.type.toLowerCase(),
        original_name: null,
        mime_type: null,
        size_bytes: null,
        created_at: document.createdAt,
        first_viewed_at: document.firstViewedAt,
        replaced_at: document.replacedAt,
      })),
    timeline: history.map((entry) => ({
      type: legacyEventType(entry.type),
      actor_type: entry.actorKind.toLowerCase(),
      from_status: entry.fromStatus === null ? null : legacyFilingStatus(entry.fromStatus),
      to_status: entry.toStatus === null ? null : legacyFilingStatus(entry.toStatus),
      payload: legacyPayload(entry.type, entry.detail),
      created_at: entry.occurredAt,
    })),
  }
}

/** 현행 목록 순서입니다. 기간 시작 내림차순, 같으면 수정 차수 내림차순, 그다음 ID 순(현행 SQL)입니다. */
export function legacyFilingOrder<A extends Pick<FilingSummary, 'id' | 'periodStart' | 'revision'>>(
  filings: readonly A[],
): A[] {
  return [...filings].sort((a, b) => {
    if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? 1 : -1
    if (a.revision !== b.revision) return b.revision - a.revision
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * 지급월을 덮는 원천세 신고 건입니다. 현행 `findWithholdingFiling`처럼 취소된 것을 빼고 수정 차수가 가장 큰 것, 같으면 ID 순 첫째입니다.
 */
export function filingCovering(filings: readonly FilingSummary[], paymentMonth: string): FilingSummary | undefined {
  const day = `${paymentMonth}-01`
  return filings
    .filter((filing) => filing.status !== 'CANCELED' && filing.periodStart <= day && filing.periodEnd >= day)
    .sort((a, b) => (a.revision !== b.revision ? b.revision - a.revision : a.id < b.id ? -1 : 1))[0]
}

/** 현행 원천징수이행상황신고서 줄 코드입니다. */
type LineCode = 'A01' | 'A03' | 'A21' | 'A25' | 'A40'

/** 현행 줄과 소득 구분입니다(현행 `withholding-summary.ts`의 `LINES`). 퇴직소득 `A21`은 따로 둡니다. */
const LINES: ReadonlyArray<{ code: LineCode; label: string; incomeTypes: readonly PayrollIncomeType[] }> = [
  { code: 'A01', label: '근로소득 간이세액', incomeTypes: ['WAGE_MONTHLY', 'WAGE_DAILY', 'WAGE_HOURLY'] },
  { code: 'A03', label: '일용근로', incomeTypes: ['DAILY'] },
  { code: 'A25', label: '사업소득 매월징수', incomeTypes: ['BUSINESS'] },
  { code: 'A40', label: '기타소득', incomeTypes: ['OTHER'] },
]

/**
 * 현행 `GET payroll/withholding-summary/:paymentMonth` 응답입니다.
 *
 * - 대장은 지급일이 그 달인 것이고, 마감된(`CLOSED`) 대장의 행만 셉니다. 계산 결과가 없는 행은 0원으로 셉니다(급여대장 조각과 같음)
 * - 인원은 줄마다 직원 ID(없으면 이름) 기준으로 중복 없이 셉니다
 * - 퇴직소득 `A21`은 새 퇴직금 정산에 지급일이 없어 지급월로 묶을 수 없으므로 인원·금액이 `null`이고 합계에서 빠집니다
 */
export function toLegacyWithholdingSummary(
  paymentMonth: string,
  ledgers: readonly PayrollLedger[],
  closed: readonly LedgerWithRows[],
  filing: FilingSummary | undefined,
): Record<string, unknown> {
  const rows = closed.flatMap(({ rows: of }) => of)
  const lines: Array<Record<string, unknown> & { code: LineCode }> = LINES.map((line) => {
    const members = rows.filter((row) => line.incomeTypes.includes(row.incomeType))
    return {
      code: line.code,
      label: line.label,
      headcount: new Set(
        members.map((row) => (row.employeeId === null ? `name:${row.payeeName}` : `id:${row.employeeId}`)),
      ).size,
      total_paid: sum(members.map((row) => row.result?.grossPay ?? 0)),
      taxable_paid: sum(members.map((row) => row.result?.taxablePay ?? 0)),
      income_tax: sum(members.map((row) => row.result?.incomeTax ?? 0)),
      local_income_tax: sum(members.map((row) => row.result?.localIncomeTax ?? 0)),
      verified: false,
    }
  })
  lines.splice(1, 0, {
    code: 'A21',
    label: '퇴직소득',
    headcount: null,
    total_paid: null,
    taxable_paid: null,
    income_tax: null,
    local_income_tax: null,
    verified: false,
  })
  const total = (key: string) => sum(lines.map((line) => (typeof line[key] === 'number' ? (line[key] as number) : 0)))
  const byId = (a: PayrollLedger, b: PayrollLedger) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return {
    payment_month: paymentMonth,
    ledger_closed: ledgers.length > 0 && ledgers.every((ledger) => ledger.status === 'CLOSED'),
    open_card_ids: ledgers
      .filter((ledger) => ledger.status !== 'CLOSED')
      .sort(byId)
      .map((ledger) => ledger.id),
    closed_card_ids: ledgers
      .filter((ledger) => ledger.status === 'CLOSED')
      .sort(byId)
      .map((ledger) => ledger.id),
    filing:
      filing === undefined
        ? null
        : { id: filing.id, status: legacyFilingStatus(filing.status), tax_period_key: legacyPeriodKey(filing) },
    lines,
    totals: {
      headcount: total('headcount'),
      total_paid: total('total_paid'),
      income_tax: total('income_tax'),
      local_income_tax: total('local_income_tax'),
    },
    verified: false,
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/**
 * 신고 건 쓰기의 새 API 거절을 현행 오류로 바꿉니다. 현행 서버(`filings.service.ts`)와 같은 상태·코드·문구입니다.
 *
 * | 새 API | 현행 |
 * |---|---|
 * | 409 `FILING_TRANSITION_INVALID`, `FILING_LOCKED` | 409 `INVALID_TRANSITION` "The filing is {status} and does not allow this action." |
 * | 403 `FILING_ACTOR_NOT_ALLOWED` | 403 `PERMISSION_DENIED` (현행은 행위자가 틀리면 권한 부족과 같은 오류였음) |
 * | 409 `REQUIREMENT_AUTO_LINKED` | 422 `code` "This item is linked automatically and cannot be edited." |
 * | 422 `REQUIREMENT_HAS_FILES` | 422 `response` "Remove the attached files before marking the item as not applicable." |
 * | 422 `FILING_REQUIREMENTS_PENDING` | 422 `requirements` "Answer every requirement item before submitting." |
 * | 412 `VERSION_MISMATCH` | 412 `VERSION_CONFLICT` "The filing was changed by someone else. Reload and try again." |
 *
 * @param status 거절 전에 읽은 신고 건 상태입니다. 새 API 오류에 지금 상태가 없을 때 씁니다.
 */
export function toLegacyFilingError(error: LegacyError, status?: FilingStatus): LegacyError {
  const invalidField = (field: string, message: string) =>
    new LegacyError(422, {
      detail: 'Request validation failed.',
      code: 'VALIDATION_FAILED',
      errors: { [field]: [message] },
    })
  switch (error.body.code) {
    case 'INVALID_TRANSITION':
    case 'FILING_LOCKED': {
      const current = typeof error.body['current_status'] === 'string' ? error.body['current_status'] : status
      const legacy = current === undefined ? 'in another state' : legacyFilingStatus(current as FilingStatus)
      return new LegacyError(409, {
        detail: `The filing is ${legacy} and does not allow this action.`,
        code: 'INVALID_TRANSITION',
      })
    }
    case 'FILING_ACTOR_NOT_ALLOWED': {
      const actor = error.body['required_actor_kind'] === 'AGENCY' ? 'agency' : 'client'
      const action = typeof error.body['action'] === 'string' ? LEGACY_TRANSITION[error.body['action']] : undefined
      return new LegacyError(403, {
        detail: `Only ${actor} users can ${action ?? 'change'} a filing.`,
        code: 'PERMISSION_DENIED',
      })
    }
    case 'REQUIREMENT_AUTO_LINKED':
      return invalidField('code', 'This item is linked automatically and cannot be edited.')
    case 'REQUIREMENT_HAS_FILES':
      return invalidField('response', 'Remove the attached files before marking the item as not applicable.')
    case 'FILING_REQUIREMENTS_PENDING':
      return invalidField('requirements', 'Answer every requirement item before submitting.')
    case 'VERSION_CONFLICT': {
      // 문구만 현행 것으로 바꾸고, 다른 조각처럼 새 API의 `current_version`은 남깁니다.
      const stale = legacyErrors.staleVersion('filing')
      return new LegacyError(412, { ...error.body, detail: stale.body.detail })
    }
    default:
      return error
  }
}
