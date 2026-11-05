import { Schema } from 'effect'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { unverifiedRatePaths } from '../engine/rate-table.ts'
import type { RateTableRecord } from './rate-table-repository.ts'

const Ppm = Schema.Int
const NullableWon = Schema.NullOr(Schema.Int)

/**
 * 기준표 응답입니다. 요율·한도·최저임금처럼 화면이 보여 주는 값만 내보내고, 간이세액 추정식·퇴직소득세 구간 같은
 * 산식 계수는 내보내지 않습니다.
 */
export const RateTable = Schema.Struct({
  id: IdSchema('rateTable'),
  effectiveFrom: Schema.String,
  minimumWage: Schema.Struct({ hourly: Schema.Int, monthly: Schema.Int, monthlyHours: Schema.Int }),
  nationalPension: Schema.Struct({
    employeeRatePpm: Ppm,
    employerRatePpm: Ppm,
    baseMin: Schema.Int,
    baseMax: Schema.Int,
  }),
  healthInsurance: Schema.Struct({ employeeRatePpm: Ppm, employerRatePpm: Ppm }),
  longTermCare: Schema.Struct({ ratioOfHealthPpm: Ppm }),
  employmentInsurance: Schema.Struct({
    employeeRatePpm: Ppm,
    employerUnemploymentRatePpm: Ppm,
    employerStabilityRatePpm: Ppm,
    artistEmployeeRatePpm: Ppm,
  }),
  industrialAccident: Schema.Struct({ defaultEmployerRatePpm: Ppm }),
  localIncomeTax: Schema.Struct({ ratePpm: Ppm }),
  dailyWorker: Schema.Struct({ dailyDeduction: Schema.Int, ratePpm: Ppm, creditPpm: Ppm }),
  businessIncome: Schema.Struct({ ratePpm: Ppm }),
  otherIncome: Schema.Struct({ ratePpm: Ppm, minimumTaxableIncome: Schema.Int }),
  smallAmountExemption: Schema.Int,
  nonTaxable: Schema.Record(Schema.String, Schema.Struct({ monthlyLimit: NullableWon, annualLimit: NullableWon })),
  /** 스펙으로 확인하지 못한 값의 경로입니다. 화면은 이 값 옆에 "미확인"을 표시합니다. */
  unverifiedPaths: Schema.Array(Schema.String),
})

/** 기준표 레코드를 응답 모양으로 바꿉니다. */
export function rateTableResponse(record: RateTableRecord): typeof RateTable.Type {
  const table = record.table
  return {
    id: record.id,
    effectiveFrom: table.effectiveFrom,
    minimumWage: table.minimumWage,
    nationalPension: table.nationalPension,
    healthInsurance: table.healthInsurance,
    longTermCare: table.longTermCare,
    employmentInsurance: table.employmentInsurance,
    industrialAccident: table.industrialAccident,
    localIncomeTax: table.localIncomeTax,
    dailyWorker: table.dailyWorker,
    businessIncome: table.businessIncome,
    otherIncome: table.otherIncome,
    smallAmountExemption: table.smallAmountExemption,
    nonTaxable: table.nonTaxable,
    unverifiedPaths: unverifiedRatePaths(table),
  }
}

/** 급여 참조 코드 응답입니다. */
export const ReferenceCodeSchema = Schema.Struct({
  code: Schema.String,
  name: Schema.String,
  expenseRatePpm: Schema.NullOr(Ppm),
  taxRatePpm: Schema.NullOr(Ppm),
  detailType: Schema.NullOr(Schema.Literals(['ARTIST', 'SPECIAL'])),
  effectiveFrom: Schema.String,
  effectiveTo: Schema.NullOr(Schema.String),
  verified: Schema.Boolean,
})
