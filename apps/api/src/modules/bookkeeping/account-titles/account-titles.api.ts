import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { PermissionDenied, VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { AccountTitleId } from '../common/ids.ts'
import { IfMatchHeaders } from '../common/wire.ts'
import {
  AccountScope,
  AccountTitle,
  AccountTitleDepthExceeded,
  AccountTitleHasChildren,
  AccountTitleMoveTargetInvalid,
  AccountTitleNameDuplicate,
  AccountTitleNotFound,
  AccountTitleSystemLocked,
} from './account-title.ts'

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(30))
const Description = Schema.String.check(Schema.isMaxLength(100))
const params = { accountTitleId: AccountTitleId }

/**
 * 계정과목 트리입니다. 기본 계정(`SYSTEM`)과 회사 계정을 깊이 우선 순서의 평평한 목록으로 줍니다.
 *
 * 하위 계정이 없던 2단계 계정에 분류된 거래가 있으면, 첫 하위 계정을 만들 때 `기타 {상위명}`이 함께 생기고 거래가 그리로 옮겨집니다.
 */
export class AccountTitlesApi extends HttpApiGroup.make('accountTitles')
  .add(
    HttpApiEndpoint.get('list', '/account-titles', {
      query: Schema.Struct({
        /** 이 화면에서 고를 수 있는 계정과 그 조상만 남깁니다. */
        appliesTo: Schema.optionalKey(AccountScope),
        search: Schema.optionalKey(Schema.String),
      }),
      success: Schema.Struct({ items: Schema.Array(AccountTitle) }),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.post('create', '/account-titles', {
      payload: Schema.Struct({
        parentId: AccountTitleId,
        name: Name,
        description: Schema.optionalKey(Description),
      }),
      success: Schema.Struct({
        accountTitle: AccountTitle,
        autoCreatedEtc: Schema.NullOr(AccountTitle),
        movedCount: Schema.Int,
      }).pipe(HttpApiSchema.status(201)),
      error: [AccountTitleNotFound, AccountTitleDepthExceeded, AccountTitleNameDuplicate, PermissionDenied],
    }),
    HttpApiEndpoint.patch('update', '/account-titles/:accountTitleId', {
      params,
      headers: IfMatchHeaders,
      payload: Schema.Struct({
        name: Schema.optionalKey(Name),
        description: Schema.optionalKey(Schema.NullOr(Description)),
      }),
      success: HttpApiSchema.WithHeaders(AccountTitle, { etag: Schema.String }),
      error: [
        AccountTitleNotFound,
        AccountTitleSystemLocked,
        AccountTitleNameDuplicate,
        VersionMismatch,
        PermissionDenied,
      ],
    }),
    HttpApiEndpoint.delete('remove', '/account-titles/:accountTitleId', {
      params,
      query: Schema.Struct({
        /** 분류된 거래를 옮길 계정입니다. 분류된 거래가 있으면 필수입니다. */
        moveToId: Schema.optionalKey(AccountTitleId),
      }),
      success: Schema.Struct({ movedCount: Schema.Int }),
      error: [
        AccountTitleNotFound,
        AccountTitleSystemLocked,
        AccountTitleHasChildren,
        AccountTitleMoveTargetInvalid,
        PermissionDenied,
      ],
    }),
  )
  .middleware(Authentication) {}
