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
