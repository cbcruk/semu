import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Authentication } from '../authentication.ts'
import {
  RequiredTermDeclined,
  Term,
  TermAgreement,
  TermDecisions,
  TermPurposeSchema,
  TermVersionOutdated,
} from './term.ts'

/** 현재 약관 조회입니다. 가입 화면이 로그인 전에 부르므로 인증하지 않습니다. 현행 `GET /api/terms/?purpose_code=`입니다. */
export class TermsApi extends HttpApiGroup.make('terms').add(
  HttpApiEndpoint.get('list', '/terms', {
    query: Schema.Struct({ purpose: TermPurposeSchema }),
    success: Schema.Struct({ items: Schema.Array(Term) }),
  }),
) {}

/**
 * 내 약관 동의 현황과 응답입니다. 현행 `GET/PATCH /api/user/me/term-agreements/?purpose=`입니다.
 *
 * 용도는 서버가 정합니다. 가입 약관은 모두에게, 세무 약관은 지금 회사가 세무 기장일 때 나옵니다.
 * 약관 게이트(403 `TERMS_REAGREEMENT_REQUIRED`)에 걸린 행위자도 이 그룹은 부를 수 있습니다.
 */
export class TermAgreementsApi extends HttpApiGroup.make('termAgreements')
  .add(
    HttpApiEndpoint.get('list', '/me/term-agreements', {
      success: Schema.Struct({ items: Schema.Array(TermAgreement) }),
    }),
    HttpApiEndpoint.post('decide', '/me/term-agreements', {
      payload: TermDecisions,
      success: Schema.Struct({ items: Schema.Array(TermAgreement) }),
      error: [RequiredTermDeclined, TermVersionOutdated],
    }),
  )
  .middleware(Authentication) {}
