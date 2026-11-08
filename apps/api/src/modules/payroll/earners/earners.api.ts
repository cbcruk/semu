import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { AccessReasonHeaders } from '../../../shared/personal-data/access-reason.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS, EarnerDuplicate, EarnerInUse, EarnerInvalid, EarnerNotFound } from '../payroll-problems.ts'
import { CreateEarner, Earner, UpdateEarner } from './earner.ts'

const params = { earnerId: IdSchema('earner') }
const ifMatch = { 'if-match': Schema.optionalKey(Schema.String) }
const WithEtag = HttpApiSchema.WithHeaders(Earner, { etag: Schema.String })

/**
 * 소득자 명부입니다. 직원이 아닌 일용·사업·기타소득자를 회사마다 두고, 직원이 없는 급여대장 행이 `earnerId`로 가리킵니다.
 *
 * 응답에는 가린 신원번호만 싣고, 원문은 `X-Access-Reason`을 받는 `:reveal`로만 줍니다(열람 기록).
 */
export class EarnersGroup extends HttpApiGroup.make('earners')
  .add(
    HttpApiEndpoint.get('list', '/earners', {
      query: PageQueryFields,
      success: Page(Earner),
      error: ACCESS_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.post('create', '/earners', {
      payload: CreateEarner,
      success: WithEtag.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, EarnerInvalid, EarnerDuplicate],
    }),
  )
  .add(
    HttpApiEndpoint.get('get', '/earners/:earnerId', {
      params,
      success: WithEtag,
      error: [...ACCESS_ERRORS, EarnerNotFound],
    }),
  )
  .add(
    HttpApiEndpoint.patch('update', '/earners/:earnerId', {
      params,
      headers: ifMatch,
      payload: UpdateEarner,
      success: WithEtag,
      error: [...ACCESS_ERRORS, EarnerNotFound, EarnerInvalid, EarnerDuplicate, VersionMismatch],
    }),
  )
  .add(
    HttpApiEndpoint.delete('delete', '/earners/:earnerId', {
      params,
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, EarnerNotFound, EarnerInUse],
    }),
  )
  .add(
    HttpApiEndpoint.post('revealRegistrationNumber', '/earners/:earnerId/registration-number::reveal', {
      params,
      headers: AccessReasonHeaders,
      success: Schema.Struct({
        identityType: Schema.Literals(['RESIDENT', 'ALIEN', 'PASSPORT']),
        registrationNumber: Schema.String,
      }),
      error: [...ACCESS_ERRORS, EarnerNotFound],
    }),
  )
  .middleware(Authentication) {}
