import type { LeavingReason } from './retirement.types'

/**
 * Leaving reasons and detail reasons, following the 고용보험 피보험자격 상실신고 reason codes.
 *
 * The legacy `employee/leaving-reason` list, the retirement form and the
 * worker's resignation letter all use this tree. Names are product labels.
 */
export const LEAVING_REASONS: readonly LeavingReason[] = [
  {
    code: '11',
    name: '개인사정으로 인한 자진퇴사',
    details: [
      { code: '11-1', name: '다른 직장으로 옮기기 위해 이직한 경우' },
      { code: '11-2', name: '학업, 육아, 간병 등 개인 사정으로 이직한 경우' },
      { code: '11-3', name: '기타 개인 사정' },
    ],
  },
  {
    code: '12',
    name: '사업장 이전, 근로조건 변동, 임금체불 등으로 자진퇴사',
    details: [
      { code: '12-1', name: '사업장 이전으로 통근이 곤란한 경우' },
      { code: '12-2', name: '근로조건이 채용 시보다 낮아진 경우' },
      { code: '12-3', name: '임금체불이 발생한 경우' },
    ],
  },
  { code: '22', name: '폐업, 도산', details: [{ code: '22-1', name: '폐업 또는 도산' }] },
  {
    code: '23',
    name: '경영상 필요 및 회사불황으로 인원감축 등에 의한 퇴사(해고·권고사직·명예퇴직 포함)',
    details: [
      { code: '23-1', name: '경영상 해고' },
      { code: '23-2', name: '권고사직' },
      { code: '23-3', name: '명예퇴직' },
    ],
  },
  { code: '26', name: '근로자의 귀책사유에 의한 징계해고·권고사직', details: [{ code: '26-1', name: '징계해고' }, { code: '26-2', name: '귀책사유로 인한 권고사직' }] },
  { code: '31', name: '정년', details: [{ code: '31-1', name: '정년퇴직' }] },
  { code: '32', name: '계약기간만료, 공사종료', details: [{ code: '32-1', name: '계약기간 만료' }, { code: '32-2', name: '공사 종료' }] },
  { code: '41', name: '고용보험 비적용', details: [{ code: '41-1', name: '고용보험 비적용' }] },
  { code: '42', name: '이중고용', details: [{ code: '42-1', name: '이중고용' }] },
]

/** Checks that a reason code exists and, when given, that the detail belongs to it. */
export function isValidLeavingReason(reason: string, detail: string | null): boolean {
  const parent = LEAVING_REASONS.find((candidate) => candidate.code === reason)
  if (parent === undefined) return false
  return detail === null || parent.details.some((candidate) => candidate.code === detail)
}
