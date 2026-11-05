# 비밀번호 정책

## 요약

- 클라이언트 검사: 8–20자, 영문과 숫자를 각각 하나 이상. 메시지는 "8자 이상 20자 이하의 영문, 숫자 혼용" 하나입니다
- 레거시 서버는 여기에 공백 금지와 확인값 일치를 더했습니다
- 비밀번호를 바꾸면 클라이언트가 `/login`으로 보냅니다. 서버는 그 사용자의 세션을 모두 폐기합니다
- 데모 사용자(`userType` 99)는 바꿀 수 없습니다
- 재설정 메일 요청은 계정이 없어도 202입니다. 재설정 토큰은 1회용이고 30분 뒤 만료됩니다(레거시 제안값)

## 현행 위치

- 번들: `validatePasswordLength`, `validatePasswordCombination` (B:96790-96791), 데모 가드 `isDemoUserType`
- 호출: `PATCH /api/user/me/password-change/`, `POST /api/request-password-change-email/:email/`, `GET /api/password-change/:token`, `POST /api/password-change/:token/`
- 레거시 구현: `apps/api/legacy/src/modules/platform/auth/password.utils.ts`, `auth/auth.service.ts`(`changeOwnPassword`, `requestPasswordReset`, `requireResetToken`, `resetPassword`)

## 로직

1. 길이 8 이상 20 이하, `[A-Za-z]` 하나 이상, 숫자 하나 이상. 한글은 영문으로 치지 않습니다
2. 레거시 서버: 공백 문자가 있으면 거절, `password !== confirm_password`면 `confirm_password` 필드 오류
3. 변경: 데모면 403 `DEMO_READ_ONLY`. 성공하면 비밀번호 해시(scrypt)를 바꾸고 세션을 모두 폐기
4. 재설정 요청: 활성 계정이고 데모가 아닐 때만 메일을 보내고, 항상 202
5. 재설정 사용: 모르는 토큰 404, 사용했거나 만료된 토큰 410. 성공하면 토큰을 쓰고 세션을 폐기

## 근거

`docs/reference/spec/platform.md:396-399`

> - 8–20자, 영문(대소문자 무관) + 숫자 각 1자 이상(B:96790-96791 `validatePasswordLength`, `validatePasswordCombination`; 공통 메시지 "8자 이상 20자 이하의 영문, 숫자 혼용"). `password === confirm_password` 서버도 검증. 공백 금지(`noSpace`) 제안.
> - 변경 성공 후 클라이언트는 `/login`으로 보냄 → 서버는 **변경 시 다른 세션 전부 무효화**.
> - 재설정: `POST /api/request-password-change-email/:email/` — 계정 존재 여부와 무관하게 202(열거 방지), 토큰 1회용·만료(제안 30분). `GET /api/password-change/:token` 유효성(404/410), `POST …/:token/ {password, confirm_password}`.
> - 데모 사용자(99)는 비밀번호 변경 불가(클라이언트 `isDemoUserType` 가드 → 서버 403 `DEMO_READ_ONLY`, D:3).

`alfred-manual/10-개인-설정-안내.md:28`

> 알프레드 로그인 후 비밀번호를 변경하려는 경우, 비밀번호 재설정을 클릭 후 새 비밀번호만 입력하면 됩니다.

`apps/api/legacy/src/modules/platform/auth/password.utils.ts:37-39`

```ts
export function isPasswordAllowed(password: string): boolean {
  return password.length >= 8 && password.length <= 20 && /[A-Za-z]/.test(password) && /\d/.test(password) && !/\s/.test(password)
}
```

## 픽스처

[`apps/api/test/fixtures/rules/password-policy.json`](../../../apps/api/test/fixtures/rules/password-policy.json): 19건 (추적 19)

| 케이스 | 결과 |
|---|---|
| 8자·20자 영문+숫자 | 통과 |
| 7자·21자, 영문만, 숫자만, 한글+숫자 | 정책 메시지 |
| 특수문자 포함 | 통과 |
| 공백 포함 | 클라이언트 통과, 레거시 서버 거절 |
| 확인값 불일치 | `confirm_password` 오류 |
| 데모 계정 변경 | 403 `DEMO_READ_ONLY` |
| 변경 성공 | 세션 전부 폐기, `/login` |
| 없는 이메일·데모 계정 재설정 요청 | 202, 메일 없음 |
| 토큰 29분 59초 / 30분 / 재사용 / 없음 | 성공 / 410 / 410 / 404 |

## 서버 이전 시 주의

- 클라이언트와 레거시 서버의 공백 규칙이 다릅니다. 서버 규칙 하나로 정하고 클라이언트는 같은 정책 코드를 표시만 합니다
- 확인값 일치는 화면 입력 검사입니다. API가 `confirmPassword`를 받을지 정해야 합니다
- 길이 상한 20자는 보안상 이유가 없습니다(해시 입력 길이와 무관). 바꾸면 기존 사용자 로그인에는 영향이 없습니다
- 세션 폐기는 현재 세션을 포함합니다. 재설계에서는 refresh token 계열 전체를 폐기합니다
- 재설정 요청이 경로에 이메일을 넣습니다(`/request-password-change-email/:email/`). 로그에 이메일이 남지 않게 본문으로 옮깁니다
