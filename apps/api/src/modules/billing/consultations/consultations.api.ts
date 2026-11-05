import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Authentication } from '../../identity-access/authentication.ts'
import { accessErrors } from '../billing-problems.ts'
import { Consultation, ConsultationAlreadyOpen, ConsultationRequest, ProductAlreadySubscribed } from './consultation.ts'

/** 로그인한 회사의 유료 상품 도입 문의입니다. 현행 서비스 카드의 `도입 문의하기`입니다. */
export class ConsultationsApi extends HttpApiGroup.make('consultations')
  .add(
    HttpApiEndpoint.post('request', '/consultations', {
      payload: ConsultationRequest,
      success: HttpApiSchema.status(201)(Consultation),
      error: [...accessErrors, ConsultationAlreadyOpen, ProductAlreadySubscribed],
    }),
  )
  .middleware(Authentication) {}
