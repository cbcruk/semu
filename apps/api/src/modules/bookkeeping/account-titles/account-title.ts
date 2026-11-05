import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import { AccountTitleId } from '../common/ids.ts'

/** 계정과목을 고를 수 있는 화면입니다. */
export const AccountScope = Schema.Literals(['SALES', 'PURCHASE', 'DEPOSIT', 'WITHDRAWAL'])

/** 손익계산서 줄입니다. `NONE`은 손익에 넣지 않습니다. */
export const PlCategory = Schema.Literals([
  'REVENUE',
  'COGS',
  'SGA',
  'NON_OPERATING_INCOME',
  'NON_OPERATING_EXPENSE',
  'INCOME_TAX',
  'NONE',
])

/**
 * 계정과목 트리의 노드 하나입니다. 목록은 깊이 우선 순서이고, `parentId`로 트리를 다시 세웁니다.
 *
 * `selectable`은 서버가 계산합니다. 하위 계정이 없는 2·3단계만 참입니다.
 */
export const AccountTitle = Schema.Struct({
  id: AccountTitleId,
  parentId: Schema.NullOr(AccountTitleId),
  depth: Schema.Literals([1, 2, 3]),
  code: Schema.NullOr(Schema.String),
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  appliesTo: Schema.Array(AccountScope),
  plCategory: PlCategory,
  cashCategory: Schema.NullOr(Schema.String),
  origin: Schema.Literals(['SYSTEM', 'COMPANY', 'AUTO_ETC']),
  selectable: Schema.Boolean,
  version: Schema.Int,
})

export type AccountTitle = typeof AccountTitle.Type

/** 요청한 계정과목이 없습니다. */
export class AccountTitleNotFound extends HttpApiError.Problem<AccountTitleNotFound>()(
  'AccountTitleNotFound',
  { type: problemType('ACCOUNT_TITLE_NOT_FOUND'), status: 404, title: 'Account title not found' },
  { code: Schema.tag('ACCOUNT_TITLE_NOT_FOUND') },
) {}

/** 이 거래를 그 계정과목으로 분류할 수 없습니다. 모르는 계정, 적용 범위 밖, 하위 계정이 있는 계정입니다. */
export class AccountTitleNotAssignable extends HttpApiError.Problem<AccountTitleNotAssignable>()(
  'AccountTitleNotAssignable',
  { type: problemType('ACCOUNT_TITLE_NOT_ASSIGNABLE'), status: 422, title: 'Account title cannot be used here' },
  {
    code: Schema.tag('ACCOUNT_TITLE_NOT_ASSIGNABLE'),
    reason: Schema.Literals(['UNKNOWN', 'SCOPE_MISMATCH', 'NOT_SELECTABLE']),
    scope: AccountScope,
  },
) {}

/** semu 기본 계정과목은 이름을 바꾸거나 지울 수 없습니다. */
export class AccountTitleSystemLocked extends HttpApiError.Problem<AccountTitleSystemLocked>()(
  'AccountTitleSystemLocked',
  { type: problemType('ACCOUNT_TITLE_SYSTEM_LOCKED'), status: 409, title: 'Default account titles cannot change' },
  { code: Schema.tag('ACCOUNT_TITLE_SYSTEM_LOCKED') },
) {}

/** 하위 계정이 남은 계정과목은 지울 수 없습니다. */
export class AccountTitleHasChildren extends HttpApiError.Problem<AccountTitleHasChildren>()(
  'AccountTitleHasChildren',
  { type: problemType('ACCOUNT_TITLE_HAS_CHILDREN'), status: 409, title: 'Account title has sub-accounts' },
  { code: Schema.tag('ACCOUNT_TITLE_HAS_CHILDREN') },
) {}

/** 같은 상위 계정 아래 같은 이름이 있습니다. */
export class AccountTitleNameDuplicate extends HttpApiError.Problem<AccountTitleNameDuplicate>()(
  'AccountTitleNameDuplicate',
  { type: problemType('ACCOUNT_TITLE_NAME_DUPLICATE'), status: 409, title: 'Account title name already used' },
  { code: Schema.tag('ACCOUNT_TITLE_NAME_DUPLICATE') },
) {}

/** 계정과목은 3단계까지입니다. */
export class AccountTitleDepthExceeded extends HttpApiError.Problem<AccountTitleDepthExceeded>()(
  'AccountTitleDepthExceeded',
  { type: problemType('ACCOUNT_TITLE_DEPTH_EXCEEDED'), status: 422, title: 'Account titles have at most three levels' },
  { code: Schema.tag('ACCOUNT_TITLE_DEPTH_EXCEEDED') },
) {}

/** 분류된 거래가 있는 계정과목을 지울 때 옮길 계정이 없거나 쓸 수 없는 계정입니다. */
export class AccountTitleMoveTargetInvalid extends HttpApiError.Problem<AccountTitleMoveTargetInvalid>()(
  'AccountTitleMoveTargetInvalid',
  { type: problemType('ACCOUNT_TITLE_MOVE_TARGET_INVALID'), status: 422, title: 'Choose where classified rows move' },
  {
    code: Schema.tag('ACCOUNT_TITLE_MOVE_TARGET_INVALID'),
    reason: Schema.Literals(['MOVE_TARGET_REQUIRED', 'MOVE_TARGET_INVALID']),
    classifiedCount: Schema.Int,
  },
) {}
