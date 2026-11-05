import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { DemoReadOnly, InvalidCredentials, PasswordPolicyViolated } from '../accounts/user.ts'
import { Authentication } from '../authentication.ts'
import { Me } from './me.ts'

/** 내 정보와 비밀번호 변경입니다. 약관 게이트에 걸린 행위자도 부를 수 있습니다. */
export class MeApi extends HttpApiGroup.make('me')
  .add(
    HttpApiEndpoint.get('get', '/me', { success: Me }),
    HttpApiEndpoint.post('changePassword', '/me/password::change', {
      payload: Schema.Struct({ currentPassword: Schema.NonEmptyString, newPassword: Schema.String }),
      success: HttpApiSchema.NoContent,
      error: [InvalidCredentials, PasswordPolicyViolated, DemoReadOnly],
    }),
  )
  .middleware(Authentication) {}
