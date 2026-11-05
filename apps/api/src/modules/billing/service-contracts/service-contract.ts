import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { DateSchema } from '../subscriptions/subscription.ts'

/** 서비스 계약 ID입니다. */
export type ServiceContractId = Id<'serviceContract'>

/**
 * 계약 종류입니다. 현행 `ContractName`을 옮겼습니다.
 *
 * - `BOOKKEEPING`: 세무 기장 수임 계약(`수임계약서`)
 * - `SOCIAL_INSURANCE_AGENCY`: 4대보험 업무대행 동의(`4대보험대행동의약관`)
 */
export const ServiceContractType = Schema.Literals(['BOOKKEEPING', 'SOCIAL_INSURANCE_AGENCY'])

/** 계약 형식입니다. `ONLINE`은 서버가 본문을 렌더하고, `PAPER`는 서명한 파일입니다. */
export const ServiceContractForm = Schema.Literals(['ONLINE', 'PAPER'])

/** 계약 상태입니다. 서명 전 단계(직접 계약 흐름)는 아직 구현하지 않았습니다. */
export const ServiceContractStatus = Schema.Literals(['ACTIVE', 'ENDED'])

/** 세무 대리인과 맺은 서비스 계약입니다. 설정 > 계약서 및 동의서 화면이 읽습니다. */
export const ServiceContract = Schema.Struct({
  id: IdSchema('serviceContract'),
  type: ServiceContractType,
  form: ServiceContractForm,
  status: ServiceContractStatus,
  /** 월 기장보수(원, VAT 별도)입니다. 기장 계약에만 있습니다. */
  monthlyFee: Schema.optionalKey(Schema.Int),
  /** 조정수수료를 받는 달입니다. 법인 3월, 개인 5월입니다. */
  adjustmentFeeMonth: Schema.optionalKey(Schema.Int),
  startsOn: DateSchema,
  endsOn: Schema.optionalKey(DateSchema),
  termMonths: Schema.Int,
  autoRenew: Schema.Boolean,
  signedAt: Schema.optionalKey(Schema.String),
  /** 실물 계약서 파일입니다. Documents 컨텍스트의 파일 ID입니다. */
  documentFileId: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
})
export type ServiceContract = typeof ServiceContract.Type

/** 저장하는 서비스 계약입니다. */
export interface ServiceContractRecord extends Omit<ServiceContract, 'id'> {
  id: ServiceContractId
  companyId: Id<'company'>
}

/** 서비스 계약이 없습니다. */
export class ServiceContractNotFound extends HttpApiError.Problem<ServiceContractNotFound>()(
  'ServiceContractNotFound',
  { type: problemType('SERVICE_CONTRACT_NOT_FOUND'), status: 404, title: 'Service contract not found' },
  { code: Schema.tag('SERVICE_CONTRACT_NOT_FOUND') },
) {}
