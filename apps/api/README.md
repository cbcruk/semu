# @semu/api

Alfred Business 백엔드 API입니다. 세무, 플랫폼·연동, 인사, 급여, 경리·보고서 도메인을 한 앱에서 제공합니다. Hono와 Node 내장 `node:sqlite`로 만들었습니다. 공통 설계는 [`docs/api-architecture.md`](../../docs/api-architecture.md), 세무 설계는 [`docs/tax-api-design.md`](../../docs/tax-api-design.md)에 있습니다.

## 요구 사항

- Node 26 이상 (`node:sqlite`)
- pnpm

## 실행

```sh
pnpm install
export JWT_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)

pnpm seed       # data/api.sqlite 생성, 데모 데이터와 신고 건 예약, 테스트용 JWT 출력
pnpm dev        # http://localhost:8787 (watch)
pnpm start
pnpm schedule   # 신고 건 예약 배치 (멱등)
```

```sh
curl -H "Authorization: Bearer <admin token>" localhost:8787/api/company/c-corp/tax/surtax/
```

## 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `JWT_SECRET` | (필수) | HS256 서명 키, 32자 이상 |
| `ENCRYPTION_KEY` | (필수) | 주민등록번호·자격 증명 암호화 키(AES-256-GCM, base64 32바이트) |
| `PORT` | `8787` | |
| `DATABASE_PATH` | `./data/api.sqlite` | |
| `STORAGE_DIR` | `./storage` | 업로드 파일 저장 위치 |
| `TAX_TERMS_VERSION` | `2026-01` | 세무 약관 동의 확인 버전 |
| `MAX_UPLOAD_BYTES` | `20971520` | 업로드 크기 상한 |

## 검증

```sh
pnpm typecheck
pnpm test
```

테스트는 `:memory:` DB와 고정 시계(`2026-11-01T09:00:00+09:00`)를 씁니다.

## 데모 계정

| ID | 설명 |
| --- | --- |
| `u-admin` | `c-corp`(법인, 세무 플랜) 관리자 |
| `u-tax` | `c-corp` 세무 권한 멤버 |
| `u-member` | `c-corp` 권한 없는 멤버 |
| `u-ind` | `c-ind`(개인) 관리자, 세무 약관 미동의 |
| `u-free` | `c-free`(무료) 관리자 |
| `u-demo` | 데모 계정(쓰기 차단) |
| `u-manager`, `u-agent` | 세무 담당 팀장과 담당자(`c-corp` 배정) |
| `u-other` | `c-ind`에만 배정된 담당자 |

JWT 페이로드는 `{ sub, company_id? }`입니다. 고객 API는 `company_id`가 경로의 회사와 같아야 하고, 담당자 API(`/api/desk`)는 `company_id` 없이 씁니다.

## 플랫폼(인증·가입·연동)

- **인증.** `Authorization: Bearer <HS256 JWT>` 또는 세션 쿠키(`sessionid`) 둘 다 받습니다. 쿠키로 인증한 `GET`·`HEAD`·`OPTIONS` 외 요청은 `X-CSRFToken`(또는 `X-XSRF-TOKEN`) 헤더가 `csrftoken`/`nexus_csrftoken` 쿠키, 세션의 CSRF 토큰과 모두 같아야 합니다.
- **로그인.** 시드 사용자는 모두 `<ID>@example.com` / `alfred1234`로 로그인합니다. 데모 계정은 `GET /api/member/demo/`가 돌려주는 `u-demo@example.com` / `demo1234`입니다.
- **회사 JWT.** `POST /api/user/me/jwt/ {company_id}`가 `{sub, company_id, sf_company_id, user_type, iat, exp}`(1시간) 토큰을 발급합니다. 회사 멤버와 배정된 담당자만 받을 수 있습니다.
- **어댑터.** 스크래핑, 메일·SMS, CMS 출금, 카카오 로그인, 사업자 상태 조회, AI 비서는 `AppDeps`의 선택 필드이고, 비우면 결정적인 가짜 구현이 쓰입니다. 가짜 스크래핑은 `wrong`으로 시작하는 비밀번호를 거절합니다.
- **시드 픽스처.** 가입 초대 토큰 `signup-invite-demo`, 상담 채널 토큰 `chat-channel-demo`, 파트너 `partner-demo`(API 키 `partner-demo-key`), 홈택스 수임동의 `htd-corp`가 있습니다. 값은 `PLATFORM_SEED`(`src/modules/platform/platform.seed.ts`)에 모여 있습니다.
- **작업.** 수집 큐는 `processScrapQueue`, 구독 상태 갱신은 `refreshSubscriptions`, 월 청구는 `runBillingCycle`(`modules/platform`)입니다. 스케줄러에는 아직 연결하지 않았습니다.
