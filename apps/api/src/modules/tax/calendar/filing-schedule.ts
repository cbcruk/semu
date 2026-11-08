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
const 기한갱신상태: ReadonlyArray<FilingStatus> = ['SCHEDULED', 'REQUESTED']

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
  const 의무키 = (value: { taxType: TaxType; kind: FilingKind; periodKey: string }): string =>
    `${value.taxType}:${value.kind}:${value.periodKey}`
  const 키별신고건 = new Map(existing.map((filing) => [의무키(filing), filing]))
  const 의무키집합 = new Set(obligations.map(의무키))

  const 계획: SchedulePlan = { create: [], refresh: [], cancel: [] }
  for (const obligation of obligations) {
    const filing = 키별신고건.get(의무키(obligation))
    if (filing === undefined) {
      계획.create.push(obligation)
    } else if (
      기한갱신상태.includes(filing.status) &&
      (filing.dueDate !== obligation.dueDate || filing.paymentDue !== obligation.paymentDue)
    ) {
      계획.refresh.push({ filingId: filing.id, obligation })
    }
  }
  for (const filing of existing) {
    // 배치 기간은 `window`(일정 배치가 신고 건을 맞추는 기간)이고 시작일·종료일 그날 포함입니다
    const 납부기한이배치기간안임 =
      filing.paymentDue !== null && filing.paymentDue >= window.from && filing.paymentDue <= window.to
    if (filing.status === 'SCHEDULED' && 납부기한이배치기간안임 && !의무키집합.has(의무키(filing)))
      계획.cancel.push(filing.id)
  }
  return 계획
}
