import type { FilingActorKind, FilingCommand, FilingStatus, TaxType } from '../tax.types.ts'
import type { FilingTransitionFacts, FilingTransitionResult, FilingTransitionRule } from './filing-status.types.ts'

/**
 * 신고 건 상태 전이표입니다. 서비스·`allowedActions`·테스트가 모두 이 표 하나를 봅니다.
 *
 * 현행 구현(`apps/api/legacy/src/modules/filings/filing-status.ts`)에서 두 가지를 바꿨습니다
 * (`docs/design/rule-decisions/tax.md`의 filing-status-transitions).
 * `:upload-ledger`는 `LEDGER_PENDING`에서도 받아 매입매출장을 바꾸고, `:cancel`은 `SUBMITTED`에서도 받습니다.
 *
 * 원천세의 `:submit`·`:unsubmit`·`:pay`는 대리인이 고객 대신 보낼 수 있습니다(2026-11-07 결정, {@link AGENCY_PROXY_TAX_TYPES}).
 * 커맨드의 차례는 그대로 고객이고, 이력에 대리인과 `onBehalfOf: CLIENT`가 남습니다.
 */
/**
 * 대리인이 고객 커맨드를 대신 보낼 수 있는 세목입니다. 2026-11-07 결정은 원천세만 다뤘습니다.
 *
 * 부가세 등 다른 세목으로 넓히려면 여기에 세목을 더합니다. 매입매출장 확인·이의(`:confirm-ledger`·`:dispute-ledger`)는
 * 고객의 의사 표시라 대행하지 않습니다(rule-decisions/tax.md filing-status-transitions 1).
 */
export const AGENCY_PROXY_TAX_TYPES: ReadonlyArray<TaxType> = ['WITHHOLDING_TAX']

export const FILING_TRANSITIONS: Record<FilingCommand, FilingTransitionRule> = {
  REQUEST: { from: ['SCHEDULED'], to: 'REQUESTED', actor: 'AGENCY' },
  SUBMIT: { from: ['REQUESTED'], to: 'SUBMITTED', actor: 'CLIENT', agencyProxyTaxTypes: AGENCY_PROXY_TAX_TYPES },
  UNSUBMIT: { from: ['SUBMITTED'], to: 'REQUESTED', actor: 'CLIENT', agencyProxyTaxTypes: AGENCY_PROXY_TAX_TYPES },
  START_REVIEW: { from: ['SCHEDULED', 'REQUESTED', 'SUBMITTED'], to: 'REVIEWING', actor: 'AGENCY' },
  REJECT: { from: ['REVIEWING'], to: 'REQUESTED', actor: 'AGENCY' },
  UPLOAD_LEDGER: { from: ['REVIEWING', 'LEDGER_PENDING'], to: 'LEDGER_PENDING', actor: 'AGENCY' },
  CONFIRM_LEDGER: { from: ['LEDGER_PENDING'], to: 'PREPARING', actor: 'CLIENT' },
  DISPUTE_LEDGER: { from: ['LEDGER_PENDING'], to: 'REVIEWING', actor: 'CLIENT' },
  START_PREPARING: { from: ['REVIEWING'], to: 'PREPARING', actor: 'AGENCY' },
  FILE: { from: ['PREPARING'], to: 'FILED', actor: 'AGENCY' },
  RECORD_NOTICE: { from: ['SCHEDULED'], to: 'FILED', actor: 'AGENCY' },
  PAY: { from: ['FILED'], to: 'SETTLED', actor: 'CLIENT', agencyProxyTaxTypes: AGENCY_PROXY_TAX_TYPES },
  CLOSE: { from: ['FILED'], to: 'SETTLED', actor: 'AGENCY' },
  CANCEL: { from: ['SCHEDULED', 'REQUESTED', 'SUBMITTED'], to: 'CANCELED', actor: 'AGENCY' },
}

/** 예정고지 건이 받는 커맨드입니다. 고지서로 끝나므로 자료 요청·검토 흐름이 없습니다. */
const NOTICE_COMMANDS: ReadonlySet<FilingCommand> = new Set(['RECORD_NOTICE', 'CANCEL', 'PAY', 'CLOSE'])

/** 고객이 자료를 고칠 수 있는 상태입니다. 그 밖의 상태에서 자료 쓰기는 409 `FILING_LOCKED`입니다. */
export const CLIENT_EDITABLE_STATUSES: ReadonlyArray<FilingStatus> = ['REQUESTED']

/** 더 할 일이 없는 상태입니다. */
export const TERMINAL_STATUSES: ReadonlyArray<FilingStatus> = ['SETTLED', 'CANCELED']

/** 신고서를 내기 전 상태입니다. 기한이 지나면 `isOverdue`가 됩니다. */
export const PRE_FILING_STATUSES: ReadonlyArray<FilingStatus> = [
  'SCHEDULED',
  'REQUESTED',
  'SUBMITTED',
  'REVIEWING',
  'LEDGER_PENDING',
  'PREPARING',
]

/**
 * 현재 상태에 신고 건 커맨드를 적용해 다음 상태를 돌려줍니다.
 *
 * 검사 순서는 행위자, 전이표, 신고 건 조건(세목·종류·세액 부호), 제출 자료입니다. 버전 검사는 서비스가 맡습니다.
 * 대리인이 대행할 수 있는 고객 커맨드(`agencyProxyTaxTypes`)를 대리인이 보내면 결과에 `onBehalfOf: 'CLIENT'`를 붙입니다.
 *
 * @example 아직 답하지 않은 항목이 있는 제출
 * ```ts
 * transitionFiling('REQUESTED', 'SUBMIT', 'CLIENT', { ...facts, pendingRequirementCodes: ['SIMPLE_RECEIPT'] })
 * // { ok: false, code: 'FILING_REQUIREMENTS_PENDING' }
 * ```
 */
export function transitionFiling(
  from: FilingStatus,
  command: FilingCommand,
  actor: FilingActorKind,
  facts: FilingTransitionFacts,
): FilingTransitionResult {
  const rule = FILING_TRANSITIONS[command]
  const proxy =
    rule.actor === 'CLIENT' && actor === 'AGENCY' && (rule.agencyProxyTaxTypes ?? []).includes(facts.taxType)
  if (rule.actor !== actor && !proxy) {
    return { ok: false, code: 'FILING_ACTOR_NOT_ALLOWED', requiredActor: rule.actor }
  }
  if (!rule.from.includes(from) || !satisfiesFacts(command, facts)) {
    return { ok: false, code: 'FILING_TRANSITION_INVALID' }
  }
  if (command === 'SUBMIT' && facts.pendingRequirementCodes.length > 0) {
    return { ok: false, code: 'FILING_REQUIREMENTS_PENDING' }
  }
  return proxy ? { ok: true, to: rule.to, onBehalfOf: 'CLIENT' } : { ok: true, to: rule.to }
}

/**
 * 행위자가 지금 보낼 수 있는 커맨드 목록입니다. 상세 응답의 `allowedActions`에 씁니다.
 *
 * 세목·종류·세액 부호로 막히는 커맨드는 뺍니다. 제출 자료가 남은 `SUBMIT`은 넣습니다.
 * 클라이언트가 버튼을 보여 주고, 누르면 서버가 남은 항목을 422로 알려 줍니다.
 *
 * 차례인 행위자의 커맨드만 넣습니다. 대리인이 대행할 수 있는 고객 커맨드는 대리인에게 넣지 않습니다.
 * 대리인 큐의 `allowedActions`가 "대리인이 할 일"로 남게 하려는 것입니다.
 */
export function allowedFilingCommands(
  status: FilingStatus,
  actor: FilingActorKind,
  facts: FilingTransitionFacts,
): FilingCommand[] {
  return (Object.keys(FILING_TRANSITIONS) as FilingCommand[]).filter((command) => {
    const rule = FILING_TRANSITIONS[command]
    return rule.actor === actor && rule.from.includes(status) && satisfiesFacts(command, facts)
  })
}

function satisfiesFacts(command: FilingCommand, facts: FilingTransitionFacts): boolean {
  if (facts.kind === 'NOTICE' && !NOTICE_COMMANDS.has(command)) return false
  switch (command) {
    case 'UPLOAD_LEDGER':
      return facts.taxType === 'VAT'
    case 'START_PREPARING':
      return facts.taxType !== 'VAT'
    case 'RECORD_NOTICE':
      return facts.kind === 'NOTICE'
    case 'PAY':
      return (facts.payableAmount ?? 0) > 0
    case 'CLOSE':
      return (facts.payableAmount ?? 0) <= 0
    default:
      return true
  }
}
