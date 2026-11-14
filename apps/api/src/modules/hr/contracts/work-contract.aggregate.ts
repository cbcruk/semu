import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { validateWorkContract } from './work-contract-validation.ts'
import { WorkContractInvalid, type WorkContractInput, type WorkContractRecord } from './work-contract.ts'

/**
 * 근로계약 애그리거트입니다(docs/design/domain-model.md). 생성과 서명 연결·풀기의 판정 함수를 둡니다.
 *
 * 근로계약은 만든 뒤 바꾸지 않습니다. 바뀌는 것은 서명 문서 연결뿐이고, 그것은 서명 문서 반영(Documents → HR)이 부릅니다.
 * 근로계약 변경은 이벤트를 내지 않습니다.
 */

/** 판정 결과입니다. */
export interface WorkContractDecision {
  workContract: WorkContractRecord
}

/** 만들 근로계약입니다. ID와 시각은 서비스가 정합니다. */
export interface WorkContractCreation {
  id: Id<'workContract'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  terms: typeof WorkContractInput.Type
}

/** 근로계약 생성을 판정합니다. 입력 규칙({@link validateWorkContract})을 어기면 거부합니다. */
export function decideWorkContractCreation(
  input: WorkContractCreation,
  at: string,
): Result.Result<WorkContractDecision, WorkContractInvalid> {
  const violations = validateWorkContract(input.terms)
  if (violations.length > 0) return Result.fail(new WorkContractInvalid({ violations }))
  return Result.succeed({
    workContract: {
      id: input.id,
      companyId: input.companyId,
      employeeId: input.employeeId,
      ...input.terms,
      createdAt: at,
    },
  })
}

/**
 * 서명 문서 연결을 바꿉니다. `from`을 주면 지금 그 문서를 가리킬 때만 바꿉니다(무효로 풀 때, 그 사이 다시 서명한 계약은 그대로
 * 둡니다). 바꿀 것이 없으면 `undefined`입니다. 근로계약은 버전이 없어 연결만 바꿉니다.
 */
export function decideWorkContractSigning(
  contract: WorkContractRecord,
  to: Id<'document'> | undefined,
  from?: Id<'document'>,
): WorkContractDecision | undefined {
  if (from !== undefined && contract.signedDocumentId !== from) return undefined
  return { workContract: { ...contract, signedDocumentId: to } }
}
