import type { Id } from '../../../shared/ids/ids.types.ts'
import type {
  FilingCommand,
  FilingDocumentType,
  FilingKind,
  FilingSettlement,
  FilingStatus,
  RequirementResponse,
  TaxType,
} from '../tax.types.ts'
import type { RequirementCode } from './filing-requirements.types.ts'

/** 신고 건 문서 ID입니다. 공유 ID 접두사 목록에 아직 없어 `fdc_`를 이 모듈에서 붙입니다. */
export type FilingDocumentId = `fdc_${string}`

/** 신고 건의 제출 자료 항목 하나입니다. */
export interface RequirementRecord {
  code: RequirementCode
  response: RequirementResponse
  autoLinked: boolean
  note: string | null
  /** 고객이 붙인 파일입니다. 파일 본문은 파일 저장소가 갖습니다. */
  fileIds: Id<'file'>[]
  updatedBy: Id<'user'> | null
  updatedAt: string | null
}

/** 대리인이 신고 건에 붙인 문서입니다. 같은 종류를 다시 붙이면 앞 문서에 `replacedAt`을 남깁니다. */
export interface FilingDocumentRecord {
  id: FilingDocumentId
  type: FilingDocumentType
  fileId: Id<'file'>
  createdAt: string
  /** 고객이 처음 연 시각입니다. */
  firstViewedAt: string | null
  replacedAt: string | null
}

/** 신고 건 이력의 종류입니다. 커맨드와 그 밖의 쓰기·배치 사건입니다. */
export type FilingHistoryType =
  | FilingCommand
  | 'SCHEDULED'
  | 'DEADLINES_REFRESHED'
  | 'SCHEDULE_CANCELED'
  | 'REQUIREMENT_ANSWERED'
  | 'REQUIREMENT_FILE_ADDED'
  | 'REQUIREMENT_FILE_REMOVED'
  | 'REQUIREMENT_LINKED'
  | 'DOCUMENT_ADDED'

/** 신고 건 이력 한 줄입니다. 지우지 않습니다. */
export interface FilingHistoryRecord {
  type: FilingHistoryType
  actorKind: 'CLIENT' | 'AGENCY' | 'SYSTEM'
  actorId: Id<'user'> | null
  fromStatus: FilingStatus | null
  toStatus: FilingStatus | null
  /** 사유·메시지·금액처럼 이력에 남길 입력입니다. */
  detail: Record<string, string | number>
  occurredAt: string
}

/**
 * 저장하는 신고 건 애그리거트입니다. 제출 자료·문서·이력을 함께 둡니다.
 *
 * 한 회사·세목·종류·기간·`revision`에 하나만 있습니다. 수정신고는 `revision`을 올린 새 신고 건입니다.
 */
export interface FilingRecord {
  id: Id<'filing'>
  companyId: Id<'company'>
  taxType: TaxType
  kind: FilingKind
  periodKey: string
  revision: number
  periodStart: string
  periodEnd: string
  statutoryDue: string | null
  dueDate: string | null
  paymentDue: string | null
  /** 고객 자료 제출 마감일입니다. 대리인이 자료를 요청할 때 정합니다. */
  submitDue: string | null
  status: FilingStatus
  payableAmount: number | null
  settlement: FilingSettlement | null
  paidOn: string | null
  ledgerUploadedAt: string | null
  ledgerConfirmedAt: string | null
  ledgerDisputeCount: number
  paymentSlipSentAt: string | null
  requirements: RequirementRecord[]
  documents: FilingDocumentRecord[]
  history: FilingHistoryRecord[]
  version: number
  createdAt: string
  updatedAt: string
}
