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

## 급여

설계는 [`docs/design/payroll.md`](../../docs/design/payroll.md)에 있습니다.

- 계산 엔진(`src/modules/payroll/engine`)은 DB를 쓰지 않는 순수 함수입니다. 진입점은 `calculatePayrollRow(input, rates)`이고, 요율은 `payroll_rate_tables`의 연·월별 기준표에서 옵니다. 앱을 시작할 때 내장 기준표(2026-01, 2026-07)를 없는 것만 넣습니다.
- 기준표의 값마다 확인 여부(`verification`)가 있습니다. 미확인 값(장기요양 요율, 간이세액 산식 계수 등)이 있으므로 **근로소득세는 공식 간이세액표를 넣기 전까지 추정치**입니다.
- 급여 설정은 `/api/company/:id/employment/settings/*`이고 급여 구독(`has_payroll_plan`)이 필요합니다. 회사의 첫 요청 때 기본 설정을 만듭니다.
- 참조 코드, `/api/tax-rates/*`, 급여계산기(`POST /api/payroll/calculator/simulate`)는 회사 경로가 아닌 인증 경로입니다.

```sh
curl -X POST -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"type":"wage","monthly_pay":3000000,"meal_allowance":200000}' \
  localhost:8787/api/payroll/calculator/simulate
```
