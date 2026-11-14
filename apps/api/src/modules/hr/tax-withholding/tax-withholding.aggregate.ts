import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { validateTaxWithholding } from './deduction-validation.ts'
import { upsertEntry } from './tax-withholding-history.ts'
import {
  TaxWithholdingInvalid,
  type TaxWithholdingEntry,
  type TaxWithholdingInput,
  type TaxWithholdingRecord,
} from './tax-withholding.ts'

const DEFAULT_ADJUSTMENT_RATE_PPM = 1_000_000

/**
 * 소득세 공제 설정 애그리거트입니다(docs/design/domain-model.md). 직원 한 명의 유효일 이력이고 버전은 이력 전체에 하나입니다.
 *
 * 근로소득자만 가질 수 있다는 검사와 버전 검사(`If-Match`)는 서비스가 판정 전에 합니다. 오류 순서(소득 구분 → 버전 → 입력)를
 * 지키려는 것입니다. 공제대상 가족 수는 저장하지 않고 조회할 때 가족에서 셉니다. 이벤트는 없습니다.
 */

/** 판정 결과입니다. `entry`는 이번에 넣은 항목입니다. */
export interface TaxWithholdingDecision {
  setting: TaxWithholdingRecord
  entry: TaxWithholdingEntry
}

/** 저장할 직원입니다. 설정 ID는 직원 ID입니다. */
export interface WithholdingOwner {
  companyId: Id<'company'>
  employeeId: Id<'employee'>
}

/**
 * 설정 저장을 판정합니다. 공제 정보 검증({@link validateTaxWithholding})을 어기면 거부합니다. 조정비율은 없으면 100%이고, 감면은
 * 검증이 채운 사유·감면율로 저장하며 적용 방식은 급여, 기간은 `effectiveFrom`으로 채웁니다. 같은 `effectiveFrom`의 항목을 바꾸거나
 * 넣어 버전을 올립니다.
 */
export function decideTaxWithholdingSave(
  owner: WithholdingOwner,
  current: TaxWithholdingRecord | undefined,
  input: TaxWithholdingInput,
  at: string,
): Result.Result<TaxWithholdingDecision, TaxWithholdingInvalid> {
  const { effectiveFrom, reduction, adjustmentRatePpm = DEFAULT_ADJUSTMENT_RATE_PPM, ...rest } = input
  const result = validateTaxWithholding({ ...rest, adjustmentRatePpm, reduction })
  if (result.violations.length > 0)
    return Result.fail(new TaxWithholdingInvalid({ violations: [...result.violations] }))
  const entry: TaxWithholdingEntry = {
    effectiveFrom,
    ...rest,
    adjustmentRatePpm,
    ...(reduction === undefined || result.reduction === undefined
      ? {}
      : {
          reduction: {
            type: reduction.type,
            reasonCode: result.reduction.reasonCode,
            ratePpm: result.reduction.ratePpm,
            // 검증을 통과했으면 적용 방식과 기간이 있습니다.
            application: reduction.application ?? 'PAYROLL',
            startDate: reduction.startDate ?? effectiveFrom,
            endDate: reduction.endDate ?? effectiveFrom,
          },
        }),
  }
  return Result.succeed({
    setting: {
      id: owner.employeeId,
      companyId: owner.companyId,
      entries: upsertEntry(current?.entries ?? [], entry),
      version: (current?.version ?? 0) + 1,
      updatedAt: at,
    },
    entry,
  })
}
