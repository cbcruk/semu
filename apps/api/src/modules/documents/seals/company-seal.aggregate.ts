import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { canAddCompanySeal } from '../templates/esign-settings-limits.ts'
import { CompanySealLimitExceeded, CompanySealNotFound, type CompanySealRecord } from './company-seal.ts'

/**
 * 회사 도장 애그리거트입니다(docs/design/domain-model.md). 등록과 삭제의 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 회사의 지우지 않은 도장 수는 서비스가 읽어 넘깁니다(회사 범위 불변식, M3).
 * 도장 변경은 이벤트를 내지 않습니다.
 */

/** 판정 결과입니다. */
export interface CompanySealDecision {
  seal: CompanySealRecord
}

/** 등록할 도장입니다. ID와 시각은 서비스가 정합니다. */
export interface CompanySealRegistrationInput {
  id: Id<'companySeal'>
  companyId: Id<'company'>
  name: string
  source: CompanySealRecord['source']
  imageFileId: Id<'file'>
  createdAt: string
}

/** 등록을 판정합니다. 지우지 않은 도장이 한도(5개)에 이르렀으면 거부합니다. */
export function decideSealRegistration(
  input: CompanySealRegistrationInput,
  activeSealCount: number,
): Result.Result<CompanySealDecision, CompanySealLimitExceeded> {
  if (!canAddCompanySeal(activeSealCount)) return Result.fail(new CompanySealLimitExceeded({}))
  return Result.succeed({ seal: { ...input } })
}

/** 삭제를 판정합니다. 지운 도장은 없는 것과 같습니다. 지우지 않고 삭제 시각을 남깁니다. */
export function decideSealRemoval(
  seal: CompanySealRecord,
  at: string,
): Result.Result<CompanySealDecision, CompanySealNotFound> {
  if (seal.deletedAt !== undefined) return Result.fail(new CompanySealNotFound({}))
  return Result.succeed({ seal: { ...seal, deletedAt: at } })
}
