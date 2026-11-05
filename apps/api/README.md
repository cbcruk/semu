# @semu/api

semu 백엔드 API 서버입니다. Effect(`effect/http-api`)로 만든 모듈러 모놀리스이고, HTTP 계약은 `src/api.ts`에 있습니다. 설계는 [`docs/design/`](../../docs/design/README.md)에서 시작하세요.

## 구성

| 경로 | 내용 |
|---|---|
| `src/shared/` | 공통 규약: 접두사 ID, RFC 9457 Problem Details, 요청 검증, 커서 페이지, `If-Match` 버전, 회사 시간대 날짜, 금액 계산 |
| `src/modules/<context>/` | 바운디드 컨텍스트 하나. `<context>.api.ts`(계약)와 `<context>.layer.ts`(핸들러·메모리 구현)를 내보냅니다 |
| `src/modules/identity-access/` | 인증 미들웨어(`Authentication`), 행위자(`CurrentActor`), 인가(`authorize`)를 모든 컨텍스트에 제공합니다 |
| `test/fixtures/rules/` | 현행 규칙의 입력 → 출력 케이스. 문서는 [`docs/reference/rules/`](../../docs/reference/rules/README.md) |
| `legacy/` | 현행 와이어를 그대로 받던 이전 구현(Hono + `node:sqlite`). 이식이 끝날 때까지 참고용으로 둡니다. 빌드·테스트 대상이 아닙니다 |

## 개발

```sh
pnpm install
pnpm dev        # http://localhost:3000/v1/health
pnpm typecheck
pnpm test
pnpm test:sqlite   # 같은 테스트를 SQLite 저장소로
pnpm format     # 또는 format:check
pnpm build
```

## 상태

서버는 SQLite에 저장합니다(`SqliteLive`, 기본 `data/semu.sqlite`). `SEMU_DATABASE=memory`면 저장하지 않습니다. 요청마다 트랜잭션 하나이고, 컨텍스트 사이 이벤트는 outbox를 거칩니다([`docs/design/conventions.md`](../../docs/design/conventions.md#코드-구조)). 테스트는 메모리 저장소(`MemoryLive`)로 돌고, `pnpm test:sqlite`는 같은 테스트를 SQLite로 돌립니다.
