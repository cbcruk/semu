# 경리·보고서 도메인 구현 설계

`docs/spec-notes/bookkeeping.md`를 `apps/api`(Hono + node:sqlite)에 옮긴 결과입니다. 스펙과 다르게 정한 점, 응답 형태를 추정한 곳, 제품 확인이 필요한 결정을 정리합니다.

## 범위

- 스펙 엔드포인트 표 71행(번들 확인 36행, 신규 설계 35행) 가운데 69행을 구현했습니다.
- 구현하지 않은 행
  - **#29 `/payment`**: 구독 결제 이력이라 platform 도메인 소관입니다.
  - **N32 `/report/labor-cost/:year`**: 인건비는 payroll의 읽기 뷰가 필요합니다. N33의 `labor-cost` 내보내기도 404입니다.
- 코드는 `apps/api/src/modules/bookkeeping/**`, 스키마는 `src/db/migrations/0040-bookkeeping.sql`에 있습니다.
- `estimated-vat` 모듈은 읽기만 합니다(`estimateVat`, `dedupeSales`, `INCLUDED_SALES_SOURCES`). 그 모듈은 수정하지 않았습니다.

## 공통 결정

- **증빙 테이블 확장.** 기존 `sales_evidence`와 `purchase_evidence`에 컬럼을 추가했습니다(`ADD COLUMN`). `external_key`는 기존 행의 id로 채우고 부분 유니크 인덱스를 둡니다. 금액, 공제 여부, `dedupe_group`은 그대로이므로 예상 부가세 숫자는 변하지 않습니다.
- **계정과목.** `account_code`는 남기고 `account_title_id`를 코드 기준으로 백필했습니다. 기본 체계는 시스템 행(`at-*`) 약 55개입니다.
  - 그룹: 매출, 영업외수익, 매출원가, 판관비, 영업외비용, 법인세등, 거래(`at-g-trade`, 손익 `none`), 자산·부채.
  - 시스템 행은 이름을 바꾸거나 지울 수 없습니다.
  - 말단 계정에 처음 하위 계정을 만들면 `기타 {상위명}`을 자동으로 만들고 기존 분류를 그리로 옮깁니다. 응답에 `auto_created_etc`와 `moved`가 들어갑니다.
  - 분류에는 말단 계정만 쓸 수 있습니다. `applies_to`(sales, purchase, deposit, withdrawal)가 맞지 않으면 422입니다.
- **내보내기.** 엑셀 대신 CSV(UTF-8 BOM)를 씁니다. 새 의존성을 추가하지 않기 위해서입니다.
- **오류 코드.** 기존 규약을 따릅니다. 값 검증은 422 `VALIDATION_FAILED`, 상태 충돌은 409, 다른 회사 자원은 404입니다.
- **경로.** 끝 슬래시 없이 등록했습니다. 스펙 표의 `/…/`는 슬래시를 뺀 경로로 읽습니다.

## 증빙과 자동분류

- `source=online`은 `mall`의 별칭입니다.
- 목록 응답의 `counts`는 분류 상태 필터를 적용하기 전의 탭 건수입니다.
- `deductible`은 본문에 보냈을 때만 바꿉니다. 매출 증빙에 보내면 422입니다.
- 수동 분류(PATCH, 일괄)는 `classified_by='manual'`로 기록하고 `classified_rule_id`를 비웁니다. 계정을 `null`로 보내면 미분류로 되돌립니다.
- 규칙
  - 조건은 모두 AND입니다. OR는 지원하지 않습니다.
  - 범위별 허용 필드와 연산자는 `SCOPE_FIELDS`에 있습니다. 증빙: partner, counterparty, item, 금액 3종, source. 입출금: summary, amount, account, direction, partner.
  - 금액 조건은 절댓값으로 비교합니다. 그래서 취소 거래(음수)도 같은 규칙에 걸립니다.
  - 우선순위가 높은 규칙부터 시도하고, 처음 맞는 규칙 하나만 적용합니다.
  - 숨긴 규칙은 적용하지 않습니다.
  - 입출금 규칙의 결과 계정이 거래 방향에 맞지 않으면(예: 출금에 매출 계정) 그 거래는 건너뜁니다.
- **이전 거래에 적용**(`apply`)
  - `fill_empty`는 계정이 빈 행만 채웁니다.
  - `overwrite`는 규칙이 분류한 행을 다시 계산합니다. 수동 분류는 덮지 않습니다(`OVERWRITE_KEEPS_MANUAL=true`).
  - 지금은 동기로 끝내고 `202`와 완료된 작업을 돌려줍니다. `rule_apply_jobs` 행을 남기므로 나중에 백그라운드 작업으로 바꿔도 계약은 같습니다.
- 수집으로 새로 들어온 행은 `fill_empty` 방식으로 바로 분류합니다.

## 입출금, 계좌, 거래처

- **계좌번호.** 계좌번호는 `deps.cipher`로 암호화합니다(`account_number_enc`). 함께 저장하는 값은 두 가지입니다.
  - 조회용 다이제스트(`account_number_digest`)
  - 끝 6자리(`account_number_tail`)
  - 응답에는 마스킹한 값만 나갑니다. 거래처 계좌도 같은 방식입니다.
- **잔액 스냅샷.** 일별 잔액은 `bank_balance_snapshots`에 둡니다.
  - 은행에서 받은 마감잔액(`scrap`)이 거래의 `balance_after`로 만든 값(`derived`)보다 우선합니다.
  - 스냅샷이 없는 날은 직전 스냅샷을 이어 씁니다.
- **증빙 연결 상태.**
  - 거래 그룹 계정(`trade`)인데 거래처가 없으면 `partner_required`입니다.
  - 거래처가 있으면, 연결 금액 합계가 거래 금액의 절댓값 이상일 때 `matched`, 아니면 `unmatched`입니다.
  - 그 밖의 계정과 미분류 거래는 `not_applicable`입니다.
- **미정산 금액.** 거래처별로 `분류된 증빙 합계(total) − 연결 금액 합계`를 매출과 매입으로 나눠 계산합니다. 미분류 증빙은 넣지 않습니다.
- **증빙 자동 연결.** 거래처를 등록하거나 사업자번호를 바꾸면, 같은 사업자번호의 증빙 중 거래처가 없는 행에 연결합니다.
- **사업자번호 중복.** 회사 안에서 사업자번호가 중복되면 422입니다.
- **휴·폐업 조회.** `BusinessStatusAdapter`(`AppDeps.businessStatus?`)로 조회합니다.
  - 결과는 하루 동안 캐시합니다.
  - 기본 가짜 구현은 끝자리 9를 폐업, 8을 휴업으로 돌려줍니다.

## 실시간 보고서

- 정책은 `bookkeeping_settings`에 있습니다. 기본값은 다음과 같습니다.
  - 공급가액 기준(`realtimePlBasis='supply'`)
  - 입출금 분류 포함(`realtimePlIncludeBank=true`)
  - 매출·매입 현황은 모든 원천 포함(`salesStatusSources='all'`)
- **실시간 손익.**
  - 증빙과 입출금 중 분류된 행만 셉니다.
  - 미분류 건수는 `unclassified_count`로 따로 줍니다.
  - 거래 그룹 계정(거래처대금 입금·지급 등)은 손익에 넣지 않습니다. 증빙과 그 대금 입출금이 이중 계상되지 않게 하기 위해서입니다.
- **자금 현황.**
  - 대상은 현금성 계좌(`account_type` 01, 31)이면서 `is_visible_on_cash_report`인 계좌입니다.
  - `other_change = closing − (opening + deposit + withdrawal)`입니다. 은행 잔액과 거래 합계가 맞지 않는 차이를 보여 줍니다.
- **홈 경영 현황(`/home/summary-cards`).** 부가세 카드의 `due_in_days`는 예정 기간 다음 달 25일까지 센 근사값입니다. 휴일은 보정하지 않습니다.

## 수집(ingestion)

```ts
ingestScrapedRecords(db, companyId, records: readonly ScrapedRecord[], context: { now, cipher }): IngestResult
```

- 리드가 제시한 3인자 시그니처와 다릅니다. 계좌번호 암호화에 `cipher`가 필요해서 네 번째 인자 `context`를 추가했습니다.
- 레코드 종류: `sales_evidence`, `purchase_evidence`, `card_transaction`, `bank_account`, `bank_transaction`, `bank_balance`, `giro_bills`.
- **멱등성.** 같은 `external_key`는 한 행입니다. 다시 수집하면 스크래핑 필드(금액, 거래처명 등)만 갱신하고, 분류·거래처·메모는 보존합니다.
- **처리 순서.** 계좌 레코드를 먼저 처리하도록 종류별로 정렬합니다. 모르는 계좌의 거래와 날짜 형식 오류는 `rejected[{index, reason}]`에 담고 나머지는 계속 처리합니다.
- **카드 승인.** 카드 승인은 매입 증빙(`source='card'`)이 됩니다. 이때 `external_key`는 `승인번호:카드번호:승인시각`입니다. `vat_amount`가 없으면 0으로 봅니다.
- **트랜잭션.**
  - 증빙과 입출금은 한 트랜잭션 안에서 저장합니다.
  - 지로 고지서는 그 뒤에 `upsertScrapedGiros`(자체 트랜잭션, 전량 갱신)로 처리합니다.
  - 시드처럼 이미 트랜잭션을 연 호출자는 `applyScrapedRecords`를 씁니다.

## 데모 시드(`c-corp`, 2026-10)

- 거래처 3곳: `pt-ecopro`, `pt-office`, `pt-landlord`.
- 규칙 5개: 입출금 3, 매입 1, 매출 1.
- 계좌 3개: `ba-main`, `ba-sub`, 대출 `ba-loan`.
- 입출금 8건.
- 증빙 연결 1건: 10/06 입금 ↔ `s-1`, 33,000,000원.
- 기존 증빙 행에는 분류 컬럼만 채웠습니다. 2026년 하반기에 증빙을 추가하지 않았고 공제 여부도 바꾸지 않았습니다.
- 10월 실시간 손익(공급가액 기준)

  | 항목 | 금액 |
  | --- | --- |
  | 매출 | 44,000,000 |
  | 매출원가 | 10,000,000 |
  | 판관비 | 11,000,000 (복리후생 800,000 + 임차료 2,200,000 + 급여 8,000,000) |
  | 영업외수익 | 30,000 |
  | 순이익 | 23,030,000 |

- 10/31 일별 자금은 기초 71,730,000, 입금 2,000,000, 출금 −300,000, 기타 변동 20,000, 기말 73,450,000입니다.

## 추정 응답 (경리·실시간 보고서)

| 경로 | 추정 형태 | 근거 |
| --- | --- | --- |
| `GET /evidence/:side` | DRF + `counts{all,classified,unclassified}`. Evidence에 `account_title_name`, `partner_name`, `classified_by`, `classified_rule_id` 포함 | N1 |
| `POST /evidence/:side/bulk-classify`, `/bank/transactions/bulk-classify` | `{updated}` | N4 |
| `GET /bank/accounts/:id/balances` | `{account_id, results[{date, closing_balance, source}]}` | 신규 |
| `POST/DELETE /bank/transactions/:id/settlements` | `{links[], settlement_status}` | N11 |
| `GET /account-titles` | 3단 트리 `[{id, parent_id, depth, name, applies_to, pl_category, is_system, is_auto_etc, is_selectable, children[]}]` | N12 |
| `POST /account-titles` | `{account_title, auto_created_etc, moved}` | N13 |
| `DELETE /account-titles/:id` | `{moved}`, 분류된 행이 있는데 `move_to_id`가 없으면 422 | N15 |
| `POST /classification-rules/preview` | DRF, `results`는 매칭된 증빙·거래 | N20 |
| `POST /classification-rules/apply` | `202 {job_id, …RuleApplyJob}` (status는 이미 `done`) | N21 |
| `GET /partners/:id/adjustment-history/:side` | DRF `[Evidence + settled_amount + remaining_amount]` + `totals{total_amount, settled_amount, remaining_amount}` | N25 |
| `GET /partner/scrap/business-status` | `{business_status, taxation_type, closed_on}` | #31 |
| `GET /reports/profit-loss/status` | N27 + `total`, `basis`, `unclassified_count` | N27 |
| `GET /reports/cash/daily` | N29 + `change`, `group_by`. 계좌 그룹은 `key=계좌 id` | N29 |
| `GET /home/summary-cards` | N31. `vat.due_in_days`는 근사값 | N31 |

## 제품 확인이 필요한 결정

1. `overwrite`가 수동 분류를 덮지 않는 것(스펙 미확인 9).
2. 실시간 손익의 기본 기준은 공급가액이고, 입출금 분류를 포함하되 거래 그룹은 빼는 것(미확인 6).
3. 매출·매입 현황은 원천 전체를 포함합니다(PG와 현금영수증 중복 허용). 예상 부가세는 `mall`과 `delivery`를 뺍니다. 그래서 두 화면 숫자가 다를 수 있습니다(미확인 7). `salesStatusSources='vat_included'`로 바꿀 수 있습니다.
4. 증빙 연결 상태는 4종(`partner_required`, `unmatched`, `matched`, `not_applicable`)이고 부분 연결을 허용합니다(미확인 10).
5. 카드 승인에 부가세가 없으면 0으로 저장합니다(공급가액 = 합계).
6. 사업자번호 중복을 409가 아닌 422로 처리합니다.

## 메뉴

`BOOKKEEPING_MENUS`의 코드는 다음과 같습니다. 모두 `requiresPermission: true`입니다.

| 코드 | 경로 | 플랜 |
| --- | --- | --- |
| `bookkeeping_sales_evidence` | `/evidence/sales/tax-invoice` | 무료 |
| `bookkeeping_purchase_evidence` | `/evidence/purchase/tax-invoice` | 무료 |
| `bookkeeping_bank_transactions` | `/bank/bank-transactions` | 무료 |
| `bookkeeping_bank_accounts` | `/bank/accounts` | 무료 |
| `bookkeeping_partners` | `/partners` | 무료 |
| `bookkeeping_sales_transactions` | `/transactions/manage/sales/list` | 무료 |
| `bookkeeping_tax_payment` | `/tax-payment/todo` | 무료 |
| `settings_accounting` | `/settings/accounting` | 무료 |
| `realtime_profit_loss` | `/reports/profit-loss/status` | 무료 |
| `realtime_cash` | `/reports/cash/daily-fund-report` | 무료 |
| `report_profit_loss` | `/settlement-reports/profit-loss/statement` | taxation |
| `settlement_reports_profit_loss_cost_details` | `/settlement-reports/profit-loss/cost-details` | taxation |
| `settlement_reports_profit_loss_labor_cost` | `/settlement-reports/profit-loss/labor-cost` | taxation |
| `report_cash` | `/settlement-reports/cash/flow` | taxation |
| `report_financial_position` | `/settlement-reports/financial-position` | taxation |

- `DEFAULT_MENU_TREE`(`src/modules/menu-tree/default-menu-tree.ts`)에 이 15개 코드의 말단을 추가해야 합니다. 이 작업에서는 그 파일을 수정하지 않았습니다.
- `settlement_reports_profit_loss_labor_cost`는 payroll이 인건비 화면을 가져갈 경우 코드가 겹칠 수 있습니다.
- 자금 흐름, 미수·미지급, 재무상태표는 플랜 검사에 더해 `requirePremiumSettlement`로 회사별 프리미엄 결산 여부를 확인합니다.

## 열린 질문 (경리·실시간 보고서)

- `bookkeeping_settings`(손익 기준, 원천 정책, 프리미엄 결산)를 바꾸는 API가 없습니다. 지금은 시드와 서비스 함수로만 바꿀 수 있습니다. 설정 화면 경로가 정해지면 추가해야 합니다.
- 외화 계좌의 원화 환산과 외화 거래 금액 표시는 저장만 하고 집계에 반영하지 않았습니다(미확인 16).
- 수집 트리거(스크래퍼 → `ingestScrapedRecords`)와 10분 쿨다운은 연결하지 않았습니다. 지금은 함수 경계만 있습니다.
- 계정과목 기본 체계와 `applies_to` 태그는 추정입니다(미확인 8).

### 세금계산서 발급·세금 납부·기타

**결정**
- 발급(`publish`)은 `issued_invoices`에 `issuing` 행을 먼저 기록하고, 어댑터 호출 뒤 `issued` 또는 `failed`로 확정합니다. 홈택스 거절은 422 `VALIDATION_FAILED`(`errors.non_field_errors`에 오류 코드)로 응답하고 실패 행은 남깁니다. 명세서는 계속 수정할 수 있습니다.
- `invoice_count`는 `status='issued'` 건수입니다. 1 이상이면 PATCH, DELETE, 재발급이 409 `INVALID_TRANSITION`입니다. 위수탁(`kind_code` 03·04)과 수정발행(`class_code` 02·04)은 422입니다.
- 공급자 정보는 본문에 없으면 회사 행(상호, 사업자번호에서 '-' 제거)으로 채웁니다. 합계는 `charge_total = Σ공급가액`, `tax_total = Σ세액`, `grand_total = charge + tax`를 검증합니다. 면세·영세율은 세액이 0이어야 합니다.
- 발급과 sync 때 `issue_no`가 같은 `sales_evidence(source='tax_invoice')`의 `sales_transaction_id`를 채웁니다. 합계는 증빙 쪽만 셉니다.
- 지로 전이: `todo|unknown → done(manual)`, `todo|unknown → hidden`, `todo → done(paid_in_app)`입니다. 그 밖의 전이는 409입니다. 이력 상태값은 `created, manual_done, hide, paid, pay_failed, unknown, scraped_done, reopened`입니다. `username`은 사용자 이메일입니다.
- 목록에서 `status`를 지정하지 않으면 숨김은 뺍니다. `/giros/:id`의 `id`에 '='가 있으면 raw 쿼리 목록으로 해석합니다.
- 납부 비밀번호는 어댑터로 전달만 하고 저장하거나 로그에 남기지 않습니다. 출금 계좌번호는 `Cipher`로 암호화하고 끝 4자리만 평문으로 둡니다.
- `request_id`는 멱등키입니다. 같은 키로 다시 요청하면 이전 결과를 돌려줍니다.
- 출금 계좌 후보에는 불투명 `id`(`bank_account:<id>` 또는 `giro_payment:<id>`)를 줍니다. 클라이언트는 마스킹된 번호 대신 이 값을 `payment_account_id`로 보냅니다.
- 낼 세금 알림(`sendTaxPaymentAlerts`)은 주말과 `public_holidays`를 건너뜁니다. `notification_deliveries`로 같은 날 같은 고지서의 중복 발송을 막습니다. 아직 스케줄러에 연결하지 않았고, 인증서 만료·조회 실패 알림은 플랫폼 연동 상태가 필요해 빠져 있습니다.
- 첨부 업로드는 서버 경유 서명 URL(HMAC, 10분, 1회)입니다. JPG, PNG, PDF만 받고 10MB 이하입니다. 파일은 `files` 테이블에 저장하고 다운로드는 API를 거칩니다.
- 회사정보 공유는 이력만 저장합니다. 메일 발송은 플랫폼 알림 모듈에 연결해야 합니다.

**추정 응답**

| 경로 | 추정 형태 | 근거 |
| --- | --- | --- |
| `GET /transaction-sales/summary/issued-status` | `{all, issue_required, issued}` | 탭 3개 |
| `GET /transaction-sales/summary` | 확인 4필드 + `issue_required_amount` | 요약 카드 "발급 필요 금액" |
| `POST …/invoices/publish`, `…/sync` | `IssuedInvoice` = 명세서 스냅샷 + `{id, transaction_id, issue_type, status, issue_no, issue_datetime, is_detail_synced, error_code, error_message}` | 데모 `latest_issue_invoice` |
| `GET /transaction-sales/:id/invoices` | `{count, next:null, previous:null, results}` | 데모 `{count, results}` |
| `POST /api/v2/…/giros/:id/payment` | 요청 `{payment_account_id? \| bank_code+account_number, account_password, amount?, request_id?}`, 응답 `{status, result_code, result_message, giro}` | 납부 모달 |
| `GET /giros/:id/payment-accounts` | `[{id, source, bank_code, account_number(마스킹), account_name}]` | 납부 모달 후보 3종 |
| `GET /attachments/get-upload-url` | `{upload_url, file_path:'files/<id>', file_id, expires_at}` | 스펙 추정 키 |
| `GET /share-histories/recent` | 데모 형태 + `{id, created, receivers}`, 이력이 없으면 `share_info:null` | js:91262 |
| `GET /home/ssb/meta` | `{cash_report_as_of:'06:00', pg_delivery_reflect_at:'11:00', classification_reflect_minutes:10, last_synced_at:{…}, as_of}` | 홈 카드 안내문(의미 미확인) |
| `GET/POST …business_types` | `[{business_type, business_class, code, is_main}]` | 스펙 추정 |
| `GET /api/bk-works/bk-schedules/current_year_end` | `{is_period, start:'YYYY-01-15', end:'YYYY-02-말일'}` | 연말정산 기간 관행 |

**열린 질문**
- 홈택스 발급 실패를 422로 둘지, 별도 오류 코드(예: `EXTERNAL_REJECTED`)를 둘지
- `invoice_type`·`issue_invoice_type` 필터 값. 지금은 `invoice_type`을 `class_code`로 해석합니다
- 지로 "대상 회사 = 지로 연동 완료" 판정. 연동 상태는 플랫폼 소관이라 지금은 구독 행만 봅니다
- 동일 내용 첨부를 재업로드하면 `UNIQUE(company_id, sha256)` 때문에 기존 파일로 합쳐져 예약 `file_path`가 무효가 됩니다. 첨부 매핑 테이블(`attachments(id, company_id, file_id)`)이 필요한지
- 납부 가능 시간(00:30–23:30)과 은행별 제한은 어댑터, 즉 은행이 판정합니다. 서버에서 미리 막을지

### 세무 보고서(결산 스냅샷)

**결정**
- **업로드.** `PUT /api/desk/companies/:cid/settlements/:year/:scope`(정규화 JSON)입니다. (회사, 연도, scope) 단위로 전량 교체하고, 같은 경로의 GET으로 마지막 결산 메타를 봅니다.
- **손익 파생 섹션.** 매출총이익, 영업이익, 당기순이익은 서버가 계산합니다. 업로드에 넣으면 422입니다.
- **섹션 합계.** `path=''` 합계가 없으면 최상위 계정 합으로 채웁니다. 매출원가처럼 차감 계정이 있는 섹션은 합계를 직접 보내야 합니다.
- **재무상태표.** `부채와자본`이 없으면 부채+자본으로 채웁니다. 상위 과목이 같은 달에 없으면 422입니다.
- **미수·미지급.** 잔액 행은 `balance = rollover + increase − decrease`를 검증합니다. 원장 행의 거래처 코드는 잔액 행에 있어야 합니다.
- **데이터가 없을 때.** 객체 응답에는 `has_data:false`, 0, `closing_list:[]`를 담고 배열 응답은 `[]`를 돌려줍니다. `has_data`는 모든 객체 응답에 추가한 필드입니다.
- **프리미엄.** 자금 흐름·미수/미지급과 재무상태표는 `requirePremiumSettlement`로 막습니다. 담당자는 통과합니다.
- **비용 분석.** 서버 계산 엔드포인트 `/report/profit-loss/:year/cost-details`를 새로 만들었습니다. 인건비 계정 목록은 `LABOR_COST_ACCOUNTS` 상수입니다.
- **내보내기.** 엑셀 대신 CSV(UTF-8 BOM)를 씁니다. 종류별로 명시 경로 `/report/{profit-loss,cost-details,receivable-payable,cash-flow,balance-sheet}/:year/export`를 둡니다.
- **시드.** `c-corp`에 2025년 1–12월과 2026년 1–9월 손익, 2026년 1–9월 재무상태표·자금·미수/미지급을 넣고 프리미엄 결산을 켭니다.

**추정 응답**

| 경로 | 추정 형태 | 근거 |
| --- | --- | --- |
| `/report/profit-loss/:year` | `data`에는 해당 연도만. `month_range`는 전년 1월부터 해당 연도 마감월까지의 `YYYYMM` | §4.4 추정 |
| `/report/profit-loss/:year/month-range` | `data`에 전년도 추가 | §4.4, 7절 5 |
| `/report/profit-loss/:year/cost-details` | `{months[{revenue,cogs,sga,non_op_expense,income_tax,cost_total,cogs_ratio,sga_ratio}], totals, sga_top, sga_details, welfare_usage{labor_cost,welfare,rate,baseline}, sections, cost_total}` | 신규, §4.5 |
| `/report/cash-flow/summary` | `funds_held`는 최종 결산월 현금성 4계정 마감잔액 합(숫자) | §4.7 |
| `/report/cash-flow/:year`, `/accounting/settlement/receivable-payable/:year` | `month`는 정수, 금액은 문자열 | §4.6, §4.7 |
| `…-by-partner/:year` | 페이지 번호 DRF(20건, next/previous는 `page=` URL). `partner_id`는 숫자로만 된 ERP 코드면 정수 | §4.6, 7절 11 |
| `…-by-partner/:year/:partnerId` | 금액은 문자열, `transaction_amount`는 감소분 음수 | §4.6 |
| `/report/balance-sheet/table/:year` | 금액은 숫자, 2단계까지, 고정 과목이 없으면 0 | §4.9 |
| `/report/balance-sheet/chart/:year` | ChartName은 자기자본비율, 부채비율, 유동비율, 총자본순이익률, 자기자본순이익률, 총자산회전율, 재고자산회전율, 매출채권회전율. 회전율은 배수(×1), 비율은 "12.34" 문자열, 분모가 0이면 null. 최상위 `ratio`는 마지막 달 값 | §4.9, js:73167 미확인 |

**열린 질문**
- 보유자금의 "연내 만기 자산"은 넣지 않았습니다.
- ChartName 실제 문자열을 확인해야 합니다.
- ROA·ROE 분자는 누적 순이익으로, 재고자산회전율 분자는 매출액으로 가정했습니다. 확인이 필요합니다.
- 회계연도는 달력 연도로 가정했습니다(`fiscal_year_end_month` 미반영).
- ERP 내보내기 파일 직접 업로드(파서)는 구현하지 않았고 정규화 JSON만 받습니다.
- 인건비 계정 목록을 확정해야 합니다.
