import type { Id } from '../../../shared/ids/ids.types.ts'

/** 고지서 상태입니다. 납부 필요, 확인 필요, 납부 완료, 숨김입니다. */
export type GiroStatus = 'TODO' | 'UNKNOWN' | 'DONE' | 'HIDDEN'

/** 납부 완료가 된 이유입니다. 앱에서 납부, 사용자가 수동 완료, 재수집 때 납부 확인입니다. */
export type GiroDoneReason = 'PAID_IN_APP' | 'MARKED_BY_USER' | 'SEEN_PAID'

/** 고지서 이력 종류입니다. */
export type GiroActionType =
  'CREATED' | 'MARKED_PAID' | 'HIDDEN' | 'PAID' | 'PAYMENT_FAILED' | 'MARKED_UNKNOWN' | 'SEEN_PAID' | 'REOPENED'

/** 고지서 상태를 바꾸는 사용자 커맨드입니다. */
export type GiroCommand = 'MARK_PAID' | 'HIDE' | 'PAY'

/** 고지서 이력 한 줄입니다. 수집이 바꾼 이력의 행위자는 `null`(시스템)입니다. */
export interface GiroAction {
  type: GiroActionType
  memo: string
  actorUserId: Id<'user'> | null
  at: string
}

/** 저장한 지로 고지서입니다. */
export interface GiroRecord {
  id: Id<'giro'>
  companyId: Id<'company'>
  /** 전자납부번호입니다. 회사 안에서 고지서의 자연 키입니다. */
  electronicPaymentNumber: string
  taxKind: 'NATIONAL' | 'LOCAL'
  slipType: string
  taxName: string
  billingOrganization: string | null
  payAmount: number
  dueDate: string | null
  /** 기관마다 다른 원문 필드입니다. */
  detail: Record<string, unknown>
  status: GiroStatus
  doneReason: GiroDoneReason | null
  memo: string
  statusChangedAt: string
  history: ReadonlyArray<GiroAction>
  version: number
}

/** 지로 납부 시도 한 건입니다. 비밀번호는 저장하지 않습니다. */
export interface GiroPaymentRecord {
  /** 납부 요청의 멱등 참조(`IdempotentAttempt.reference`)입니다. 이 규칙 이전 행은 `<고지서 ID>:<Idempotency-Key>`입니다. */
  id: string
  companyId: Id<'company'>
  giroId: Id<'giro'>
  bankCode: string
  accountNumberEncrypted: string
  accountNumberLast4: string
  amount: number
  status: 'REQUESTED' | 'SUCCEEDED' | 'FAILED'
  resultCode: string | null
  resultMessage: string | null
  requestedBy: Id<'user'>
  createdAt: string
}

/** 수집한 고지서 한 장입니다. Integrations가 인터넷지로 전체 목록을 새로 읽을 때 보냅니다. */
export interface ScrapedGiroBill {
  electronicPaymentNumber: string
  taxKind: 'NATIONAL' | 'LOCAL'
  slipType: string
  taxName: string
  billingOrganization?: string
  payAmount: number
  /** 납기 내 기한입니다. 국세는 `pay_date1`, 지방세는 `pay_date`입니다. */
  dueDate?: string
  detail: Record<string, unknown>
  /** 수집기가 이미 납부된 것으로 본 고지서입니다. */
  isPaid?: boolean
}
