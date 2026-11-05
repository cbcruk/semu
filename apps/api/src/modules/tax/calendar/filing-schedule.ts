import type { FilingKind, FilingStatus, TaxType } from '../tax.types.ts'
import type { FilingObligation } from './filing-calendar.types.ts'

/** 일정 배치가 보는 저장된 신고 건입니다. */
export interface ScheduledFilingFact {
  id: string
  taxType: TaxType
  kind: FilingKind
  periodKey: string
  status: FilingStatus
  dueDate: string | null
  paymentDue: string | null
}

/** 일정 배치 한 번이 할 일입니다. */
export interface SchedulePlan {
  /** 아직 신고 건이 없는 의무입니다. */
  create: FilingObligation[]
  /** 기한이 바뀐 신고 건과 새 기한입니다. */
  refresh: { filingId: string; obligation: FilingObligation }[]
  /** 더는 해당하지 않는 `SCHEDULED` 신고 건입니다. */
  cancel: string[]
}

/** 기한을 다시 맞추는 상태입니다. 고객이 자료를 내기 시작한 뒤에는 기한을 바꾸지 않습니다. */
const REFRESHABLE: ReadonlyArray<FilingStatus> = ['SCHEDULED', 'REQUESTED']

/**
 * 계산한 신고 의무와 저장된 신고 건을 맞춥니다. 같은 입력으로 다시 돌리면 아무것도 하지 않습니다.
 *
 * - 의무에 맞는 신고 건(세목·종류·기간)이 없으면 만듭니다. 취소된 신고 건도 있는 것으로 보고 다시 만들지 않습니다
 * - `SCHEDULED`·`REQUESTED` 신고 건의 기한이 달라졌으면(공휴일표·회사 설정 변경) 새로 맞춥니다
 * - 기간 안의 `SCHEDULED` 신고 건이 의무에 없으면(반기 납부로 바뀐 매월 원천세 등) 취소합니다
 *
 * `obligations`는 납부 기한이 `window` 안에 드는 의무이고, `existing`은 회사의 신고 건 전체입니다.
 */
export function planSchedule(
  obligations: ReadonlyArray<FilingObligation>,
  existing: ReadonlyArray<ScheduledFilingFact>,
  window: { from: string; to: string },
): SchedulePlan {
  const keyOf = (value: { taxType: TaxType; kind: FilingKind; periodKey: string }): string =>
    `${value.taxType}:${value.kind}:${value.periodKey}`
  const byKey = new Map(existing.map((filing) => [keyOf(filing), filing]))
  const expected = new Set(obligations.map(keyOf))

  const plan: SchedulePlan = { create: [], refresh: [], cancel: [] }
  for (const obligation of obligations) {
    const filing = byKey.get(keyOf(obligation))
    if (filing === undefined) {
      plan.create.push(obligation)
    } else if (
      REFRESHABLE.includes(filing.status) &&
      (filing.dueDate !== obligation.dueDate || filing.paymentDue !== obligation.paymentDue)
    ) {
      plan.refresh.push({ filingId: filing.id, obligation })
    }
  }
  for (const filing of existing) {
    const inWindow = filing.paymentDue !== null && filing.paymentDue >= window.from && filing.paymentDue <= window.to
    if (filing.status === 'SCHEDULED' && inWindow && !expected.has(keyOf(filing))) plan.cancel.push(filing.id)
  }
  return plan
}
