import { Schema } from 'effect'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { Won } from '../payroll-schema.ts'
import type { SeveranceSettlementRecord, SeveranceStatus } from './severance-settlement.types.ts'

/** 퇴직금 계산 입력입니다. 입사일·마지막 근무일은 HR에서 받습니다. */
export const SeveranceInputSchema = Schema.Struct({
  /** 퇴직일 이전 3개 역월에 지급한 임금입니다. */
  threeMonthWages: Won,
  /** 그 3개월의 일수입니다. 없으면 달력으로 셉니다. */
  threeMonthDays: Schema.optionalKey(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)))),
  /** 최근 12개월 상여 총액입니다. 3/12을 더합니다. */
  annualBonus: Schema.optionalKey(Won),
  /** 전년도 미사용 연차수당입니다. 3/12을 더합니다. */
  annualLeavePay: Schema.optionalKey(Won),
  /** 1일 통상임금입니다. 평균임금보다 높으면 이것을 씁니다. */
  ordinaryDailyWage: Schema.optionalKey(Won),
})

/** `POST /severance-settlements` 본문입니다. */
export const CreateSeveranceSettlement = Schema.Struct({
  employeeId: IdSchema('employee'),
  input: SeveranceInputSchema,
})

const Status = Schema.Literals(['CALCULATED', 'COMPLETED', 'EXCLUDED'])

/** 퇴직금 정산 응답입니다. */
export const SeveranceSettlement = Schema.Struct({
  id: IdSchema('severanceSettlement'),
  employeeId: IdSchema('employee'),
  employeeName: Schema.String,
  joinDate: Schema.String,
  lastWorkDate: Schema.String,
  status: Status,
  input: SeveranceInputSchema,
  result: Schema.Struct({
    eligible: Schema.Boolean,
    serviceDays: Schema.Int,
    averageDailyWage: Schema.Int,
    usedOrdinaryWage: Schema.Boolean,
    severancePay: Schema.Int,
    retirementIncomeTax: Schema.Int,
    localIncomeTax: Schema.Int,
    netPay: Schema.Int,
    breakdown: Schema.Array(
      Schema.Struct({ code: Schema.String, label: Schema.String, amount: Schema.Int, formula: Schema.String }),
    ),
  }),
  /** 퇴직소득세에 쓴 기준표(퇴직월)입니다. */
  rateTable: Schema.String,
  allowedActions: Schema.Array(Schema.Literals(['UPDATE', 'COMPLETE', 'REOPEN', 'EXCLUDE', 'INCLUDE'])),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

/** 퇴직금 정산 커맨드입니다. */
export type SeveranceCommand = 'COMPLETE' | 'REOPEN' | 'EXCLUDE' | 'INCLUDE'

/** 퇴직금 정산 전이표입니다. 계산됨에서만 입력을 고치고, 완료·제외는 되돌릴 수 있습니다. */
export const SEVERANCE_TRANSITIONS: Record<SeveranceCommand, { from: SeveranceStatus; to: SeveranceStatus }> = {
  COMPLETE: { from: 'CALCULATED', to: 'COMPLETED' },
  REOPEN: { from: 'COMPLETED', to: 'CALCULATED' },
  EXCLUDE: { from: 'CALCULATED', to: 'EXCLUDED' },
  INCLUDE: { from: 'EXCLUDED', to: 'CALCULATED' },
}

/** 상세 응답의 `allowedActions`입니다. */
export function severanceActions(status: SeveranceStatus): Array<'UPDATE' | SeveranceCommand> {
  const commands = (Object.keys(SEVERANCE_TRANSITIONS) as SeveranceCommand[]).filter(
    (command) => SEVERANCE_TRANSITIONS[command].from === status,
  )
  return status === 'CALCULATED' ? ['UPDATE', ...commands] : commands
}

/** 레코드를 응답으로 바꿉니다. */
export function severanceResponse(record: SeveranceSettlementRecord): typeof SeveranceSettlement.Type {
  return { ...record, allowedActions: severanceActions(record.status) }
}
