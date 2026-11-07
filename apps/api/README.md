# @semu/api

semu 백엔드 API 서버입니다. Effect(`effect/http-api`)로 만든 모듈러 모놀리스이고, HTTP 계약은 `src/api.ts`에 있습니다. 설계는 [`docs/design/`](../../docs/design/README.md)에서 시작하세요.

## 구성

| 경로 | 내용 |
|---|---|
| `src/shared/` | 공통 규약: 접두사 ID, RFC 9457 Problem Details, 요청 검증, 커서 페이지, `If-Match` 버전, 회사 시간대 날짜, 금액 계산 |
| `src/modules/<context>/` | 바운디드 컨텍스트 하나. `<context>.api.ts`(계약)와 `<context>.layer.ts`(핸들러·메모리 구현)를 내보냅니다 |
| `src/modules/identity-access/` | 인증 미들웨어(`Authentication`), 행위자(`CurrentActor`), 인가(`authorize`)를 모든 컨텍스트에 제공합니다 |
| `test/fixtures/rules/` | 현행 규칙의 입력 → 출력 케이스. 문서는 [`docs/reference/rules/`](../../docs/reference/rules/README.md) |

## 이전 구현(`legacy/`)

현행 와이어를 그대로 받던 이전 구현(Hono + `node:sqlite`)은 2026-11-07에 지웠습니다. 문서·주석·규칙 픽스처가 인용하는 `apps/api/legacy/...` 경로는 커밋 `f115042`의 트리를 가리킵니다. 원문은 `git show f115042:apps/api/legacy/<경로>`로 봅니다.

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

서버는 SQLite에 저장합니다(`SqliteLive`, 기본 `data/semu.sqlite`). `SEMU_DATABASE=memory`면 저장하지 않습니다. 주민등록번호·계좌번호·연동 비밀번호는 AES-256-GCM으로 암호화해 저장하고, 데이터 키는 `SEMU_DATA_KEY`(base64 32바이트)에서 읽습니다. 없으면 데이터베이스 옆 `semu.key`(권한 0600)를 만들어 다시 씁니다. 이 파일을 잃으면 저장된 암호문을 열 수 없으므로, 데이터가 있는 데이터베이스에 키 파일이 없거나 데이터베이스에 남긴 키 지문과 다른 키면 서버가 시작을 거부합니다. 키 지문 없이 데이터가 있는 데이터베이스(데이터 암호화 이전에 만든 것)도 시작을 거부하므로 그 `data/semu.sqlite`는 지우고 다시 만듭니다. Bookkeeping 계좌번호의 암호화 용도를 필드별(`bookkeeping/companyAccount`·`partnerAccount`·`giroAccount`)로 나누기 전에 이전 용도(`bookkeeping/account-number`)로 저장한 계좌번호는 새 용도로 열 수 없으므로, 그 전에 만든 데이터베이스도 지우고 다시 만듭니다([`docs/design/compliance.md`](../../docs/design/compliance.md#개인정보-최소-노출)). 요청마다 트랜잭션 하나이고, 컨텍스트 사이 이벤트는 outbox를 거칩니다([`docs/design/conventions.md`](../../docs/design/conventions.md#코드-구조)). 테스트는 메모리 저장소(`MemoryLive`)로 돌고, `pnpm test:sqlite`는 같은 테스트를 SQLite로 돌립니다.
