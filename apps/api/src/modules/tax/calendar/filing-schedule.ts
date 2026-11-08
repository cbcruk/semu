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
  /**
   * 취소한 주체입니다. 일정 배치가 취소했으면(마지막 이력 `SCHEDULE_CANCELED`) `SCHEDULE`, 사람이 `:cancel`로 취소했으면
   * `USER`, 취소되지 않았으면 `null`입니다.
   */
  canceledBy: 'SCHEDULE' | 'USER' | null
}

/** 일정 배치 한 번이 할 일입니다. */
export interface SchedulePlan {
  /** 아직 신고 건이 없는 의무입니다. */
  create: FilingObligation[]
  /** 기한이 바뀐 신고 건과 새 기한입니다. */
  refresh: { filingId: string; obligation: FilingObligation }[]
  /** 일정 배치가 취소했는데 의무가 다시 생긴 신고 건입니다. `SCHEDULED`로 되살리고 기한을 새로 맞춥니다. */
  restore: { filingId: string; obligation: FilingObligation }[]
  /** 더는 해당하지 않는 `SCHEDULED` 신고 건입니다. */
  cancel: string[]
}

/** 기한을 다시 맞추는 상태입니다. 고객이 자료를 내기 시작한 뒤에는 기한을 바꾸지 않습니다. */
const 기한갱신상태: ReadonlyArray<FilingStatus> = ['SCHEDULED', 'REQUESTED']

type ObligationKey = { taxType: TaxType; kind: FilingKind; periodKey: string }

const 의무키 = (value: ObligationKey): string => `${value.taxType}:${value.kind}:${value.periodKey}`

/**
 * 같은 기간에 하나만 있어야 하는 의무의 자리입니다. 부가세 예정고지(`NOTICE`)와 예정 신고(`PRELIMINARY`)는 같은
 * 예정신고기간을 두고 판정에 따라 갈리므로 한 자리이고, 그 밖에는 의무 키가 자리입니다.
 */
const 자리키 = (value: ObligationKey): string =>
  value.taxType === 'VAT' && (value.kind === 'NOTICE' || value.kind === 'PRELIMINARY')
    ? `VAT:PRELIMINARY_SLOT:${value.periodKey}`
    : 의무키(value)

/**
 * 계산한 신고 의무와 저장된 신고 건을 맞춥니다. 같은 입력으로 다시 돌리면 아무것도 하지 않습니다.
 *
 * - 의무에 맞는 신고 건(세목·종류·기간)이 없으면 만듭니다. 일정 배치가 취소한 신고 건은 의무가 다시 생기면
 *   `SCHEDULED`로 되살립니다(예정고지 판정 입력을 고쳤다가 되돌린 경우)
 * - 사람이 손댄 자리(`SCHEDULED`를 지난 신고 건이나 사람이 취소한 신고 건이 있는 자리)에는 만들거나 되살리지 않습니다.
 *   부가세 예정고지와 예정 신고는 예정신고기간마다 한 자리라서, 판정이 바뀌어도 진행 중이거나 대리인이 취소한
 *   예정 건 곁에 다른 종류를 두지 않습니다
 * - `SCHEDULED`·`REQUESTED` 신고 건의 기한이 달라졌으면(공휴일표·회사 설정 변경) 새로 맞춥니다
 * - 기간 안의 `SCHEDULED` 신고 건이 의무에 없으면(반기 납부로 바뀐 매월 원천세, 판정이 바뀐 예정 건 등) 취소합니다
 *
 * `obligations`는 납부 기한이 `window` 안에 드는 의무이고, `existing`은 회사의 신고 건 전체입니다.
 */
export function planSchedule(
  obligations: ReadonlyArray<FilingObligation>,
  existing: ReadonlyArray<ScheduledFilingFact>,
  window: { from: string; to: string },
): SchedulePlan {
  const 키별신고건 = new Map(existing.map((filing) => [의무키(filing), filing]))
  const 의무키집합 = new Set(obligations.map(의무키))
  // 사람이 손댄 자리입니다. `SCHEDULED`를 지난 취소되지 않은 건이 있거나 사람이 취소한 건이 있습니다
  const 막힌자리 = new Set(
    existing
      .filter((filing) => (filing.status === 'CANCELED' ? filing.canceledBy === 'USER' : filing.status !== 'SCHEDULED'))
      .map((filing) => 자리키(filing)),
  )

  const 계획: SchedulePlan = { create: [], refresh: [], restore: [], cancel: [] }
  for (const obligation of obligations) {
    const filing = 키별신고건.get(의무키(obligation))
    if (filing !== undefined && filing.status !== 'CANCELED') {
      const 기한이바뀜 = filing.dueDate !== obligation.dueDate || filing.paymentDue !== obligation.paymentDue
      if (기한갱신상태.includes(filing.status) && 기한이바뀜) 계획.refresh.push({ filingId: filing.id, obligation })
    } else if (!막힌자리.has(자리키(obligation))) {
      if (filing === undefined) 계획.create.push(obligation)
      else 계획.restore.push({ filingId: filing.id, obligation })
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
