import type { FilingActorKind, FilingKind, FilingStatus, TaxType } from '../tax.types.ts'

/** 전이 하나의 출발 상태, 도착 상태, 보낼 수 있는 행위자입니다. */
export interface FilingTransitionRule {
  from: ReadonlyArray<FilingStatus>
  to: FilingStatus
  actor: FilingActorKind
}

/** 전이 허용 여부를 바꾸는 신고 건의 사실입니다. */
export interface FilingTransitionFacts {
  taxType: TaxType
  kind: FilingKind
  /** 신고·고지로 정해진 납부할 세액입니다. 음수는 환급이고, 아직 정해지지 않았으면 `null`입니다. */
  payableAmount: number | null
  /** 고객이 아직 답하지 않은 제출 자료 항목 코드입니다. 자동 연계 항목은 넣지 않습니다. */
  pendingRequirementCodes: ReadonlyArray<string>
}

/** 신고 건 상태 전이를 거부할 때 돌려주는 오류 코드입니다. */
export type FilingTransitionErrorCode =
  'FILING_TRANSITION_INVALID' | 'FILING_ACTOR_NOT_ALLOWED' | 'FILING_REQUIREMENTS_PENDING'

/** 현재 상태에 신고 건 커맨드를 적용해 본 결과입니다. */
export type FilingTransitionResult =
  { ok: true; to: FilingStatus } | { ok: false; code: FilingTransitionErrorCode; requiredActor?: FilingActorKind }
