# @semu/bff

현행 웹 클라이언트의 와이어(옛 경로, snake_case, DRF 봉투, `{detail, code}` 오류, 세션 쿠키 + CSRF)를 받아 새 API(`/v1`)로 옮겨 부르는 호환 계층입니다. 설계는 [`docs/design/bff.md`](../../docs/design/bff.md)에 있습니다. 화면이 모두 새 API로 옮겨 가면 지웁니다.

## 구성

| 경로 | 내용 |
|---|---|
| `src/app.ts` | `createBff`: 경로 표(`ROUTES`), 세션 쿠키·CSRF 확인, 오류 응답 |
| `src/upstream.ts` | 새 API 호출, 토큰 갱신·회사 전환(세션별 읽기·쓰기 자물쇠) |
| `src/legacy-error.ts`, `src/keys.ts` | 문제(RFC 9457) → 현행 오류, 키 이름 변환과 `LEGACY_RAW_KEYS` |
| `src/<context>/` | 화면 조각별 현행 경로(`*.routes.ts`)와 응답 매퍼(`*.mapping.ts`) |
| `test/` | 현행 브라우저를 흉내 낸 클라이언트로 새 API 앱(프로세스 안) 위에서 돌리는 HTTP 테스트 |

## 개발

테스트는 `../api`의 앱을 프로세스 안에서 띄우므로 `apps/api`에서도 `pnpm install`이 되어 있어야 합니다.

```sh
pnpm install
pnpm dev           # http://localhost:3100, SEMU_API_URL=http://localhost:3000
pnpm typecheck
pnpm test
pnpm test:sqlite   # 새 API를 SQLite 저장소로
pnpm format        # 또는 format:check
```

| 환경 변수 | 기본 | 뜻 |
|---|---|---|
| `PORT` | `3100` | BFF 포트 |
| `SEMU_API_URL` | `http://localhost:3000` | 새 API 주소 |
| `BFF_PUBLIC_URL` | `http://localhost:$PORT` | 현행 클라이언트가 부르는 공개 주소. DRF 링크에 씁니다 |
| `BFF_ALLOWED_ORIGINS` | `BFF_PUBLIC_URL`의 출처 | 로그인을 받는 브라우저 출처(쉼표로 여럿) |
| `BFF_UPSTREAM_TIMEOUT_MS` | `10000` | 새 API 요청 하나의 제한 시간 |
