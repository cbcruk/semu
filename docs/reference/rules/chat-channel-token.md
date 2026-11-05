# 상담 채널 연결 토큰

## 요약

- 카카오톡·슬랙 상담 채널에서 받은 링크(`?action=chat-integration&token=&channel_name=&messenger_type=`)로 들어오면, 클라이언트가 토큰을 검증하고 회사를 고르게 한 뒤 연결합니다
- 실패 사유는 영어 문장 `token is invalid | token is used | token is expired`이고, 클라이언트가 이 문자열을 그대로 비교해 안내 문구를 고릅니다
- 토큰 상태는 `발급 → 사용됨 | 만료`입니다. 레거시 서버는 없음 → 사용됨 → 만료 순서로 검사합니다

## 현행 위치

- 번들: 랜딩 처리 B:100743-100800, sf `member.chatChannel.get/post`(B:74644-74650)
- 레거시 서버: `apps/api/legacy/src/modules/platform/external/external.service.ts`의 `checkChatChannelToken`, `connectChatChannel`

## 로직

- 링크 쿼리 `action === 'chat-integration'`이면 흐름을 시작하고 `token`, `channel_name`, `messenger_type(slack|kakaotalk)`을 읽습니다
- `GET /api/member/chat-channel/?token=`
  - 토큰 해시가 없으면 `token is invalid`
  - `used_at`이 있으면 `token is used`
  - `now >= expires_at`이면 `token is expired`
  - 통과하면 `{messenger_type, channel_name, expires_at}`
- 회사 선택 후 `POST /api/member/chat-channel/ {token, company_id(sf)}`: 같은 검증, 회사 소속이 아니면 403 `PERMISSION_DENIED`, 성공하면 `used_at`, `used_by`, `company_id`를 기록
- 레거시 서버의 실패는 422 `{code: VALIDATION_FAILED, detail, fail_reason}`

## 근거

`docs/reference/spec/platform.md:116`

> - 상담 채널 연동(카카오톡/슬랙): 채널에서 받은 링크 `?action=chat-integration&token=&channel_name=&messenger_type=slack|kakaotalk` → sf `GET /api/member/chat-channel/?token=`(검증) → 회사 선택 → `POST /api/member/chat-channel/ {token, company_id(sf)}`. 오류 `failReason`: `token is invalid | token is used | token is expired`(B:100743-100800).

`docs/reference/spec/platform.md:387-389`

> ### 3.5 상담 채널 토큰 / 외부 payload
>
> `issued → used`(POST 성공) | `expired`. 오류 문자열은 `token is invalid|used|expired` 그대로(클라이언트가 문자열 매칭).

`apps/api/legacy/src/modules/platform/external/external.service.ts:165-167`

```ts
if (row === undefined) throw chatFailure('token is invalid')
if (row.used_at !== null) throw chatFailure('token is used')
if (!isBefore(deps.clock.now(), row.expires_at)) throw chatFailure('token is expired')
```

## 픽스처

[`apps/api/test/fixtures/rules/chat-channel-token.json`](../../../apps/api/test/fixtures/rules/chat-channel-token.json): 11건 (추적 11)

| 케이스 | 입력 | 결과 |
|---|---|---|
| `action=chat-integration` 링크 | | 흐름 시작 |
| 유효한 토큰 | | 채널 정보 |
| 없는 / 사용된 / 만료 시각과 같은 토큰 | | `invalid` / `used` / `expired` |
| 사용됨 + 만료 | | `used` 우선 |
| 소속 회사로 연결 | | 201, 토큰 사용 처리 |
| 소속 아닌 회사 | | 403, 토큰 그대로 |
| 같은 토큰 두 번 연결 | | `used` |

## 서버 이전 시 주의

- 문장 매칭을 없애고 `code`(`CHAT_CHANNEL_TOKEN_INVALID|USED|EXPIRED`)로 구분합니다 ([conventions.md](../../design/conventions.md#오류))
- 재설계에서는 회사 ID가 토큰에서 정해지므로 본문의 `company_id`(sf ID)가 필요 없습니다. 다른 회사로 연결하려면 회사를 전환한 뒤 연결합니다
- 토큰 수명은 메신저 브리지가 정합니다. 클라이언트에는 없습니다
- 연결에 회사 소속 외의 권한(관리자 등)이 필요한지 정해야 합니다
- 토큰은 해시만 저장합니다(레거시와 같음)

