import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { applyInsuranceFilingCommand, OPEN_STATUSES } from './insurance-filing-rules.ts'
import { InsuranceFilingTransitionInvalid } from './insurance-filing.ts'
import type {
  InsuranceFiling,
  InsuranceFilingCommand,
  InsuranceFilingKind,
  InsuranceFilingSource,
} from './insurance-filing.types.ts'

/**
 * 4대보험 신고 애그리거트입니다(docs/design/domain-model.md). 대리인의 처리(완료·실패) 판정과, 다른 커맨드가 신고를 열기 전에
 * 거둘 신고를 고르는 규칙을 둡니다.
 *
 * - 처리: 열린 상태(`PENDING`·`FAILED`)에서만 합니다({@link applyInsuranceFilingCommand})
 * - 원인·종류마다 열린 신고는 하나입니다. 새 신고를 열기 전에 같은 원인·종류의 열린 신고를 거둡니다({@link withdrawnFilings}).
 *   저장소의 `withdraw`가 이 함수를 쓰고, 직원·휴직·가족·급여계약 서비스와 4단계(M6) 정책이 저장소를 거쳐 같은 규칙을 씁니다
 *
 * 신고 열기(`pendingFiling`)는 ID를 만들어 저장소 파일에 둡니다. 신고는 이벤트를 내지 않습니다.
 */

/** 판정 결과입니다. */
export interface InsuranceFilingDecision {
  filing: InsuranceFiling
}

/** 대리인의 처리를 판정합니다. 닫힌 신고(`DONE`·`WITHDRAWN`)면 거부합니다. */
export function decideInsuranceFilingProcess(
  filing: InsuranceFiling,
  command: InsuranceFilingCommand,
  at: string,
): Result.Result<InsuranceFilingDecision, InsuranceFilingTransitionInvalid> {
  const next = applyInsuranceFilingCommand(filing, command, at)
  return next === undefined
    ? Result.fail(new InsuranceFilingTransitionInvalid({ currentStatus: filing.status }))
    : Result.succeed({ filing: next })
}

/** 열린 신고(`PENDING`·`FAILED`)인지입니다. */
export function isOpenFiling(filing: Pick<InsuranceFiling, 'status'>): boolean {
  return OPEN_STATUSES.includes(filing.status)
}

function withdrawn(filing: InsuranceFiling, at: string): InsuranceFiling {
  return { ...filing, status: 'WITHDRAWN', processedAt: at }
}

/**
 * 원인이 같은 종류의 열린 신고를 거둔 결과입니다. 바뀐 신고만 돌려줍니다. 새 신고를 열기 전에 불러 원인·종류마다 열린 신고를
 * 하나로 지킵니다.
 */
export function withdrawnFilings(
  filings: ReadonlyArray<InsuranceFiling>,
  source: InsuranceFilingSource,
  kind: InsuranceFilingKind,
  at: string,
): InsuranceFiling[] {
  return filings
    .filter(
      (filing) =>
        filing.kind === kind &&
        isOpenFiling(filing) &&
        filing.source.type === source.type &&
        filing.source.id === source.id,
    )
    .map((filing) => withdrawn(filing, at))
}

/** 직원을 지울 때 그 직원의 열린 신고를 모두 거둔 결과입니다. 바뀐 신고만 돌려줍니다. */
export function withdrawnEmployeeFilings(
  filings: ReadonlyArray<InsuranceFiling>,
  employeeId: Id<'employee'>,
  at: string,
): InsuranceFiling[] {
  return filings
    .filter((filing) => filing.employeeId === employeeId && isOpenFiling(filing))
    .map((filing) => withdrawn(filing, at))
}
