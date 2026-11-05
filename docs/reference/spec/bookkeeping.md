# 경리·보고서 도메인 스펙 노트

스키마와 API를 설계할 사람을 위한 메모입니다. 근거마다 출처를 달았습니다.

- **번들**: `app-alfred-kr/reverse/index.pretty.js:<line>`. 줄여서 `js:<line>`으로 씁니다.
- **매뉴얼**: `alfred-manual/...`. 줄여서 `M:<경로>`로 씁니다.
- **스크린샷**: `alfred-manual/images/<hash>`. 줄여서 `img:<hash>`로 씁니다.

표기 규칙은 다음과 같습니다.

- **확인**: 번들 코드나 데모 목업에 실제로 있는 값입니다.
- **추정**: 스크린샷이나 매뉴얼에서 추론한 값입니다.
- **신규 설계**: 번들에 없는 엔드포인트입니다. 화면 컴포넌트가 lazy chunk 안에 있어서 번들에서 보이지 않습니다.

`docs/tax-api-design.md`(이하 "기존 설계")의 와이어 규약은 그대로 따릅니다. snake_case, 경로 끝 슬래시 허용, DRF 봉투, 에러 형식, `STRICT` 테이블, 금액 `INTEGER`, 날짜 `TEXT`가 그 내용입니다.

> **중요: 백엔드가 3개로 나뉘어 있습니다.** 번들에서 이 도메인의 API 모듈은 세 클라이언트에 흩어져 있습니다.
>
> | 클라이언트 | 모듈 | 근거 |
> | --- | --- | --- |
> | **sf-api** (`getApi$2`, 쿠키+XSRF) | `accounting`, `report`, `yearEndSett` | js:74688 |
> | **remittance-api** (`https://remittance-api.heumtax.com`, `Authorization: Bearer <회사 JWT>`, params `arrayFormat: repeat`) | `giro`, `certificate`, `transaction`, `company`, `integration`, `partner` | `getApi`, js:89513–89543 |
> | **nexus-api** | `alfredHome.getSsbMeta`, `companyPayment.getCompanyPayments` | js:72382–72383 |
>
> Hono 단일 서버로 합치더라도 경로는 그대로 두어야 합니다. 그러면 클라이언트는 base URL만 바꾸면 됩니다. remittance 경로에는 **경로 끝 슬래시가 없는 것**이 많고(`/giros/summary`, `/transaction-sales/summary`), 인증은 JWT Bearer입니다. 이 점을 인증 미들웨어에서 둘 다 받도록 처리해야 합니다.

---

## 1. 화면과 흐름

### 1.1 라우트와 화면 매핑

| 화면 | 라우트 (`routes.tsv`) | 매뉴얼 | 데이터 원천 |
| --- | --- | --- | --- |
| 홈 경영 현황 카드 (자금 전일 / 손익 이달 / 예상 부가세 분기) | `/dashboard` | M:02-홈/01, img:a70a47f07e32a88dc052 | 실시간 집계. "매일 06:00 기준, PG·배달 매출은 11:00경 반영" |
| 매출 증빙 관리 (탭: 세금계산서·신용카드·현금영수증·PG사·배달·쇼핑몰) | `/evidence/sales/{tax-invoice,card,cash-receipt,pg,delivery,online}` (+`/legacy/*`) | M:03-경리/01 | `sales_evidence` |
| 매입 증빙 관리 (탭: 세금계산서·신용카드·현금영수증) | `/evidence/purchase/{tax-invoice,card,cash-receipt}` | M:03-경리/02 | `purchase_evidence` |
| 규칙 관리 (매출·매입·입출금 공통 모달) | 화면 내 모달 | M:03-경리/01/01 | `classification_rules` |
| 입출금 관리 | `/bank/bank-transactions` | M:03-경리/03, img:d125abeeac9131b2b9a3 | `bank_transactions` |
| 계좌 목록 | `/bank/accounts` | M:03-경리/04, img:7fb254ab2d2ab113b7d5 | `bank_accounts` |
| 거래처 관리 (목록·등록·상세: 기본정보 / 매출·매입 정산이력 / 입출금 이력) | `/partners/`, `/partners/create`, `/partners/:partnerId/{detail-info,adjustment-history/sales,adjustment-history/purchase,bank-transaction-history}` | M:03-경리/05 | `partners` |
| 세금계산서 발급 (거래명세서 목록·등록·상세·수정·복사·인쇄) | `/transactions/manage/sales/{list,create,:id,:id/edit,:id/copy,:id/print}` | M:03-경리/06 | `sales_transactions`, `issued_invoices` |
| 세금 납부 (탭 `:selectedTab` = todo 등) | `/tax-payment/:selectedTab` (`/payment/tax`에서 리다이렉트, js:103077) | M:03-경리/07 | `giros` |
| 계정과목 관리 | `/settings/accounting` | M:08-설정/04 | `account_titles` |
| 실시간 보고서 > 손익 현황 (탭: 손익 / 매출·매입) | `/reports/profit-loss/{status,sales-purchase}` (구 `/basic-reports/sales-purchase`, `/financial/reports/profit-loss`) | M:02-홈/04/01/01 | 증빙과 입출금의 분류 결과 |
| 실시간 보고서 > 자금 현황 (탭: 일별 자금 / 기간별 추이) | `/reports/cash/{daily-fund-report,period-fund-graph}` (구 `/financial/reports/cash-status/*`) | M:02-홈/04/01/02 | 입출금과 잔액 |
| 세무 보고서 > 손익계산서 (탭: 손익계산서 / 비용 분석 / 인건비 내역) | `/settlement-reports/profit-loss/{statement,cost-details,labor-cost}` | M:02-홈/04/01/03 | 결산 데이터 |
| 세무 보고서 > 자금 보고 (탭: 자금 흐름 / 미수·미지급금) | `/settlement-reports/cash/{flow,receivable-payable}` | M:02-홈/04/01/04 | 결산 데이터 |
| 세무 보고서 > 재무상태표 | `/settlement-reports/financial-position` | M:02-홈/04/01/05 | 결산 데이터 |

라우트 상수는 `REPORT_PATHS`와 `SETTLEMENT_REPORT_PATHS`입니다(js:88408–88437). 세무 보고서 쪽 기능 키는 다음과 같습니다.

- `PROFIT_LOSS_MENU_CODE = "report_profit_loss"`
- `SETTLEMENT_PROFIT_LOSS_FEATURE_KEYS = { costDetails: "settlement_reports_profit_loss_cost_details", laborCost: "settlement_reports_profit_loss_labor_cost" }`

이 값들이 메뉴 코드 체계의 실제 예시입니다. 기존 설계 3절의 "가정"을 보강합니다.

### 1.2 플랜별 노출 (M:09, M:08-설정/07/01-알프레드-홈/README)

| 묶음 | 대상 | 원천 |
| --- | --- | --- |
| 경리 전체, 실시간 보고서(손익 현황·자금 현황·예상 부가세) | 전체 (구독 무관) | 연동 수집 데이터와 분류 |
| 세무 보고서 > 손익계산서(손익·비용 분석) | 세무 구독(`tax_plan='taxation'`) | 담당자가 올린 (가)결산 ERP 데이터 |
| 손익계산서 > 인건비 내역 | 세무 구독 + **회사 관리자 또는 인사 메뉴 열람 권한** | 마감(계산 완료)된 급여카드 |
| 자금 보고(자금 흐름·미수/미지급), 재무상태표 | 세무 구독 중 **프리미엄 결산(월/분기/반기) 대상** | 결산 데이터 |

결산 데이터가 없는 고객에게는 **예시 데이터**를 보여 줍니다. 현행 구현은 클라이언트 데모 목업(`createReportDemoApi`, `createAccountingDemoApi`, js:75696, js:75859)입니다. 새 서버는 `has_data=false`를 내려 주고, 화면이 예시를 고르도록 하는 쪽을 권합니다.

### 1.3 핵심 업무 흐름

1. **수집**: 새벽 배치가 연동 기관(홈택스, 여신금융협회, 카드사, PG, 배달, 올라, 은행)에서 전일분을 가져옵니다. 사용자는 수동 새로고침을 할 수 있고 재시도 간격은 10분입니다. 은행은 연동일 기준 92일 전부터 가져옵니다(M:03-경리/03).
2. **분류**: 각 증빙과 입출금에 계정과목(+거래처)을 붙입니다. 방법은 수동 드롭다운이나 규칙기반 자동분류입니다. 분류된 내역이 보고서에 반영되기까지 "약 5~10분"이 걸립니다(img:d7eb8f888abf41fba796 안내문). 집계는 비동기나 캐시라고 추정합니다.
3. **매칭**: 입출금을 거래처의 미수/미지급 내역과 연결합니다. 이것이 "증빙 연결" 컬럼입니다(img:d125abeeac9131b2b9a3). 상태 값으로 "거래처 필요"가 보입니다.
4. **실시간 보고서**: 2와 3의 결과를 바로 집계합니다. "1. 연동 기관에서 수집 → 2. 계정과목 분류 완료"된 항목만 집계합니다(M:02-홈/04/README).
5. **세무 보고서**: 담당자가 세무사랑 ERP에서 결산한 뒤 "보고서 업데이트"를 누르면 스냅샷이 올라옵니다. 실시간 데이터와는 **독립**입니다. 매뉴얼은 "자금내역은 계좌조회 금액과 동일하지 않다"고 명시합니다(M:…/12).
6. **세금계산서 발급**: 거래명세서(`transaction-sales`)를 저장하고, `publish`로 홈택스 발급을 요청합니다. 그다음 `sync`로 상세를 동기화합니다. 수정 발행은 지원하지 않습니다.
7. **세금 납부**: 사용자가 인터넷지로 "내역 업데이트"를 누르면 고지서를 가져옵니다(자동 업데이트 없음). 납부는 출금계좌와 비밀번호로 처리하고, 다른 경로로 낸 세금은 수동 완료 처리합니다. 평일 09:30에 D-3~D-day 알림을 보냅니다.

---

## 2. 엔티티와 필드

### 2.1 증빙 (sales_evidence / purchase_evidence): 기존 테이블 확장

기존 테이블(`0001-init.sql:206–230`)은 예상 부가세 계산에 필요한 최소 컬럼만 갖고 있습니다. 경리 화면을 만들려면 아래 컬럼이 더 필요합니다. **기존 컬럼과 enum은 바꾸지 않고 덧붙이기만** 합니다. 예외는 `purchase_evidence.account_code` 하나이며, 아래 "변경 필요"에서 다룹니다.

| 컬럼 | sales | purchase | 근거 | 비고 |
| --- | --- | --- | --- | --- |
| `external_key TEXT NOT NULL` | O | O | 수집 멱등성 | `UNIQUE(company_id, source, external_key)`. 세금계산서는 승인번호, 카드는 승인번호+카드번호+일시 |
| `doc_type TEXT` | O | O | img:796d68a887119abf9951 "유형" 컬럼 | `tax_invoice` / `modified_tax_invoice` / `invoice`(계산서) / `modified_invoice`. `InvoiceClass` 01–04(js:89398)와 대응 |
| `kind TEXT` | O | O | 같은 이미지 "종류: 일반" 필터 | `normal` / `zero_rate` / `delegation` / `zero_rate_delegation`. `InvoiceKind` 01–04와 대응 |
| `written_on TEXT` | O | O | "작성일자" | 기존 `issued_on`은 **발급일자**로 유지합니다. 세금계산서만 둘이 다르고, 화면 정렬 기본값은 작성일자입니다 |
| `counterparty_business_number TEXT` | O | O | "거래처(공급받는 자)" | 매출이면 공급받는 자, 매입이면 공급자 |
| `counterparty_name TEXT` | O | O | | |
| `partner_id TEXT` | O | O | 규칙 결과 "거래처", 매칭 | FK → `partners`. 사업자번호로 자동 연결 |
| `item_summary TEXT` | O | O | img:6df1e428ca852cfcac7a "품목" ("… 외 24건") | 규칙 조건 `item`의 대상 |
| `total_amount INTEGER` | 기존 | **추가** | 합계금액 | 매입에는 지금 없음 |
| `account_title_id TEXT` | O | O | "분류" 드롭다운 | FK → `account_titles`. NULL이면 미분류입니다. 화면 placeholder는 "계정과목 선택" |
| `classified_by TEXT` | O | O | 번개 아이콘 "규칙으로 분류" | `manual` / `rule` / NULL |
| `classified_rule_id TEXT` | O | O | | FK → `classification_rules` |
| `memo TEXT` | O | O | "메모" 입력 | 기장 담당자에게는 보이지 않습니다(입출금 매뉴얼 기준) |
| `card_number_masked`, `card_company_code`, `approval_no` | card | card | | `CreditCardCode` 001–020 (js:90244) |
| `channel TEXT` | pg/delivery/mall | – | | PG는 `PgCompany` enum(`NICEPAY`, `TOSSPAYMENTS`, `INICIS`, `TOSSPAY`, `NAVERPAY`, `UPLUS`, `EXIMBAY`, `HECTO`, `KSNET`, js:89181), 배달은 `DeliveryCorp`(`baemin`, `coupangeats`, `yogiyo`, js:90238), 쇼핑몰(올라)은 `SUPPORTED_SCM_LIST` |
| `is_canceled INTEGER` | O | O | 음수 금액 행 | 취소는 음수 금액으로 들어옵니다(img:3e61f6e2529f6f888ce3의 수정세금계산서 -22,000원). 기존 설계 6절의 부호 규칙과 일치합니다 |
| `sales_transaction_id TEXT` | tax_invoice | – | 직접 발급분과의 연결 | 2.8절 |
| `deductible` | – | 기존 | | 매입세액 공제 여부. 계정과목에서 기본값을 가져오고 수동으로 덮어쓸 수 있습니다(추정) |

**변경 필요.**

1. `purchase_evidence.account_code TEXT`를 `account_title_id`로 대체합니다. 하위 계정을 만들거나 지우면 재분류가 일어나므로 FK가 필요합니다. 이관할 때 `account_code`는 base 계정 코드로 매핑합니다.
2. 목록 정렬과 필터를 위해 인덱스를 둡니다: `(company_id, source, written_on)`, `(company_id, account_title_id)`.
3. 기존 sales source `mall`은 화면 탭 "쇼핑몰" 및 라우트 `online`과 같은 것입니다. 경로 세그먼트 `online`을 `mall`로 매핑합니다.
4. 기존 설계 6절의 `unclassified_count`는 `account_title_id IS NULL` 건수로 정의합니다.

**목록 화면 공통 UI** (img:3e61f6e2529f6f888ce3, img:796d68a887119abf9951, img:4731d6438a08885d75e6)

- 조회 단위 "월별 조회"와 월 선택(이전달·다음달)이 있습니다.
- 상태 탭은 `전체 내역 N / 분류 완료 N / 미분류 N`입니다.
- 필터는 `계정과목`, `유형`, `종류`입니다. 검색 대상은 거래처명, 사업자등록번호, 메모입니다.
- 컬럼은 체크박스, 작성일자↕, 유형, 종류, 거래처, 합계금액↕, 공급가액, 세액, 발급일자↕, (품목), 분류, 메모입니다.
- 일괄 선택 체크박스가 있으므로 일괄 분류 API가 필요합니다(추정).

### 2.2 계정과목 (account_titles)

근거는 M:08-설정/04, img:378c70650336b58e4917, img:07252f695982ec2f47a2, img:796d68a887119abf9951입니다.

**3단 트리입니다.**

- **1차 (그룹)**: 예를 들어 `거래대금`("거래처와의 매출·매입 거래에서 발생하는 자금 입출금"), `영업외수익`, 매출, 판매비와관리비 등입니다.
- **2차 (semu 기본 계정)**: 이름, 설명, **적용 범위 태그** `매출`·`매입`(추정)·`입금`·`출금`이 있습니다. 예시는 다음과 같습니다.
  - 매출대금 입금 [입금, 출금]
  - 매입 취소 대금 입금
  - 개인경비정산
  - 매입대금 출금
  - 이자수익 [입금, 출금]
  - 정부지원금 수취 [매출, 입금, 출금]
  - 세금환급, 배당금수익, 잡이익, 유형/무형/금융/기타자산처분이익, 기타영업외수익
- **3차 (하위 계정)**: semu 기본 하위 계정도 있습니다. 예를 들어 매출대금 입금 아래의 거래처대금 입금, 현금영수증 매출 대금 입금, 카드 매출 대금 입금, 기타 매출 대금 입금입니다. 회사가 `+ 신규 계정과목`으로 직접 추가할 수도 있습니다.
- 매출 증빙 드롭다운의 그룹은 `매출`(매출, 매출 취소)과 `영업외수익`(이자수익, 정부지원금, 세금환급, 배당금수익…)입니다. 즉 **화면별로 태그에 맞는 계정만** 보여 줍니다. 드롭다운 안에서 계정명을 검색할 수 있습니다.

```sql
CREATE TABLE account_titles (
  id            TEXT PRIMARY KEY,
  company_id    TEXT REFERENCES companies(id),       -- NULL = semu 기본(전사 공통)
  parent_id     TEXT REFERENCES account_titles(id),
  depth         INTEGER NOT NULL CHECK (depth IN (1,2,3)),
  code          TEXT,                                 -- 기본 계정 고유 코드(번들 미확인, 신규 부여)
  name          TEXT NOT NULL,
  description   TEXT,
  applies_to    TEXT NOT NULL,                        -- JSON 배열 ⊂ ['sales','purchase','deposit','withdrawal']
  pl_category   TEXT CHECK (pl_category IN ('revenue','cogs','sga','non_op_income','non_op_expense','income_tax','none')),
  cash_category TEXT,                                 -- 자금 현황 '카테고리별' 라벨(매출 대금, 카드사 정산, 급여 …)
  is_system     INTEGER NOT NULL DEFAULT 1,
  is_auto_etc   INTEGER NOT NULL DEFAULT 0,           -- '기타 {상위명}' 자동 생성분
  sort_order    INTEGER NOT NULL,
  deleted_at    TEXT,
  UNIQUE (company_id, parent_id, name)
) STRICT;
```

**규칙**

- 하위 계정을 처음 추가할 때 상위 계정에 이미 분류된 거래가 있으면, `기타 {상위명}` 3차 계정을 자동으로 만들고 **기존 거래를 그쪽으로 이관**합니다. 증빙과 입출금의 `account_title_id`를 일괄 UPDATE하므로 트랜잭션 하나로 처리합니다.
- 회사 계정을 삭제할 때 분류된 거래가 있으면 이동 대상 계정 `move_to`가 필수입니다. 거래는 지우지 않습니다. 규칙의 결과 계정도 함께 바꿔야 합니다(추정).
- 하위 계정이 생긴 2차 계정은 더 이상 직접 선택할 수 없다고 추정합니다. "기타" 자동 생성이 그 근거입니다.
- 보고서 집계는 `pl_category`와 `cash_category`를 **2차 기준으로 상속**합니다.

### 2.3 규칙기반 자동분류 (classification_rules)

근거는 M:03-경리/01/01, img:f913d2c5e61b169aea16, img:f4e46e36e8078c98a92a입니다.

- **범위**: 규칙은 메뉴별로 따로 관리합니다. 범위는 `sales_evidence`, `purchase_evidence`, `bank_transaction` 셋이고, 모달 제목은 "매출 증빙 규칙 관리"입니다. 미리보기 테이블이 증빙 유형 탭(세금계산서 등) 단위이므로 source 제한을 둘 수도 있습니다(미확인).
- **구성**: 이름, "이런 거래면"(조건 N개, AND로 결합), "이렇게 처리해요"(결과: 계정과목 그리고/또는 거래처)입니다.
- **조건 필드**: 증빙은 `거래처`, `품목`, `합계금액`, `공급가액`, `세액`입니다. 입출금은 적요, 금액, 계좌, 구분으로 추정합니다.
- **연산자** (화면 문구 기준)
  - 거래처: `포함`(다중 선택, "에코프로비엠 외 1개")
  - 품목: `(으)로 시작`. `포함`·`일치`도 있을 것으로 추정합니다.
  - 금액: `이상`(1,000원 이상), `범위`(0원 ~ 500,000원). `이하`도 있을 것으로 추정합니다.
- **우선순위**: 드래그로 순서를 바꿉니다. 위에서부터 **처음 매칭되는 규칙 하나**만 적용한다고 추정합니다. 결과가 하나뿐이고 순서 변경 UI가 있다는 점이 근거입니다.
- **상태**: 카드 메뉴의 `편집 / 복사 후 편집 / 숨김`과 "숨김 보기" 토글을 보면, 숨김이 곧 비활성입니다.
- **적용 시점**: 신규 수집분에는 자동으로 적용합니다. 이전 거래에는 "이전 거래에도 적용하기"로 일괄 적용하며, 모드는 둘입니다.
  - `fill_empty` (빈 항목만 채우기): `account_title_id IS NULL`인 거래만 대상
  - `overwrite` (입력된 항목도 덮어쓰기): 모든 거래 대상. 단 `classified_by='manual'`도 덮어쓰는지는 미확인입니다.
  - 일괄 적용은 진행률을 보여 주는 비동기 작업입니다(img:74727e1194680e8a2b4a).
- **미리보기**: 조건을 입력하는 동안 오른쪽 테이블이 실시간으로 갱신되고, 25개씩 페이지를 나눕니다. 그래서 저장하지 않은 규칙으로 매칭 결과를 조회하는 API가 필요합니다.

```sql
CREATE TABLE classification_rules (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  scope       TEXT NOT NULL CHECK (scope IN ('sales','purchase','bank')),
  name        TEXT NOT NULL,
  conditions  TEXT NOT NULL CHECK (json_valid(conditions)), -- [{field, op, values|min|max}]
  result_account_title_id TEXT REFERENCES account_titles(id),
  result_partner_id       TEXT REFERENCES partners(id),
  priority    INTEGER NOT NULL,           -- 작을수록 먼저
  is_hidden   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (company_id, id),
  CHECK (result_account_title_id IS NOT NULL OR result_partner_id IS NOT NULL)
) STRICT;
CREATE TABLE rule_apply_jobs (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, scope TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fill_empty','overwrite')), status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  total INTEGER, processed INTEGER, created_at TEXT NOT NULL, finished_at TEXT) STRICT;
```

조건 JSON 예시는 다음과 같습니다.

```json
[{"field":"partner","op":"in","values":["p_1","p_2"]},
 {"field":"supply_amount","op":"between","min":0,"max":500000},
 {"field":"item","op":"starts_with","values":["통신비"]}]
```

### 2.4 은행 계좌와 잔액 (bank_accounts)

연동 응답의 계좌 형태는 데모 `banks`에서 확인했습니다(js:90267–90380).

```text
integration: { id, bank_code, is_corporate, certificate{...}, account_list[] }
account: { id, integration_id, account_name, account_number, account_type, open_date, end_date,
           balance, currency_code, is_dormant, holder, last_transaction_date, is_scrap_available,
           last_scrap_status{status,code,message,is_initial,...}, is_active, external_key,
           is_visible_on_cash_report }
```

- `account_type`(`AccountType`, js:90227): `01` 요구불(입출금), `02` 적금, `11` 신탁, `21` 펀드, `31` 외화/골드, `41` 대출, `51` 보험/공제, `61` 연금
- `bank_code`: `BankCode` 3자리(js:89901~)
- 회사당 최대 20계좌입니다(`maxRegisterBankAccountCount: 20`).
- **계좌 목록 화면**(img:7fb254ab2d2ab113b7d5)은 다음 항목을 보여 줍니다.
  - 연동 계좌 수
  - 총 자산과 그 내역: 입출금, 외화/골드, 예금/적금, 펀드, 신탁/ISA, 보험/공제, 연금
  - 총 부채(대출)
  - 계좌 카드: 은행, 기업/개인 배지, 계좌명, 번호, 잔액, 최근 거래일, 만기일, "내역 보기"
  - 외화 계좌의 통화별 잔액과 적용 환율

  여기서 **총 자산 = Σ balance where account_type ≠ '41'**이고 **총 부채 = Σ balance where account_type = '41'**입니다(추정). 외화는 KRW로 환산해서 더합니다.
- `is_visible_on_cash_report`는 자금 현황의 "계좌 표시 설정"입니다(img:dfda2ae39c6b6acfac49). 자금 집계에서 빼는 계좌를 정합니다.

추가 테이블은 다음과 같습니다.

```sql
CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, integration_id TEXT NOT NULL,
  bank_code TEXT NOT NULL, account_number TEXT NOT NULL, account_name TEXT, account_type TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'KRW', holder TEXT, open_date TEXT, end_date TEXT,
  balance INTEGER, balance_fx TEXT,               -- 외화는 소수 → TEXT(decimal)
  is_dormant INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
  is_visible_on_cash_report INTEGER NOT NULL DEFAULT 1, last_transaction_date TEXT, external_key TEXT,
  UNIQUE (company_id, bank_code, account_number)) STRICT;
CREATE TABLE bank_balance_snapshots (account_id TEXT NOT NULL, date TEXT NOT NULL, closing_balance INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('scrap','derived')), PRIMARY KEY (account_id, date)) STRICT;
```

`bank_balance_snapshots`는 일별 시작·마감 잔액과 "기타 잔액 변동"을 계산할 때 씁니다(4.3절). 연동을 해제한 계좌도 과거 내역은 계속 조회할 수 있어야 합니다(M:03-경리/03). 그래서 삭제하지 않고 `is_active=0`으로 둡니다.

### 2.5 입출금 거래 (bank_transactions)

근거는 img:d125abeeac9131b2b9a3입니다.

- **필터**: 월 선택, `전체 / 분류 필요 / 분류 완료`, `구분`(입금/출금), `계좌`, `계정과목`이 있습니다.
- **검색**: 적요, 거래처, 메모를 대상으로 합니다.
- **기타 기능**: 엑셀 저장과 규칙 관리가 있습니다.
- **요약 카드**: 입금액 총합계, 출금액 총합계(음수), 입출금 합계입니다.
- **컬럼**: 체크박스, 일시↕, 구분, 계좌(은행 + 끝 6자리), 금액↕(출금은 음수), 잔액(거래 후), 적요, 계정과목 드롭다운, 거래처 드롭다운, 메모(최대 50자), 증빙 연결(ⓘ, 값 예시 "거래처 필요")입니다.

```sql
CREATE TABLE bank_transactions (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  external_key TEXT NOT NULL, transacted_at TEXT NOT NULL,          -- 시각(분 단위)
  direction TEXT NOT NULL CHECK (direction IN ('deposit','withdrawal')),
  amount INTEGER NOT NULL,              -- 부호 포함(출금 음수) — 화면 표기와 동일
  balance_after INTEGER, summary TEXT,  -- 적요
  currency_code TEXT NOT NULL DEFAULT 'KRW', amount_fx TEXT,
  account_title_id TEXT, classified_by TEXT, classified_rule_id TEXT,
  partner_id TEXT, memo TEXT CHECK (length(memo) <= 50),
  settlement_status TEXT CHECK (settlement_status IN ('partner_required','unmatched','matched','not_applicable')),
  UNIQUE (company_id, account_id, external_key)) STRICT;
CREATE INDEX bank_tx_period ON bank_transactions (company_id, transacted_at);
```

증빙 연결(매칭)은 N:M으로 둡니다. 부분 입금과 묶음 입금이 있기 때문입니다.

```sql
CREATE TABLE settlement_links (id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
  bank_transaction_id TEXT NOT NULL, evidence_side TEXT NOT NULL CHECK (evidence_side IN ('sales','purchase')),
  evidence_id TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL) STRICT;
```

`settlement_status` 판정 규칙은 다음과 같습니다(추정).

| 조건 | 값 |
| --- | --- |
| 계정이 거래대금 그룹이 아님 | `not_applicable` |
| 거래대금 그룹인데 `partner_id`가 NULL | `partner_required` (화면 "거래처 필요") |
| 거래대금 그룹이고 연결된 금액의 합이 거래 금액의 절댓값과 같음 | `matched` |
| 그 밖의 경우 | `unmatched` |

### 2.6 카드 거래

- **매입(법인/개인카드 사용)**: `purchase_evidence`의 `source='card'`입니다. 카드 연동 구조는 데모 `creditcards`(js:90755)에서 확인했습니다.
  - integration: `{ id, creditcard_code, is_corporate, certificate, card_list[] }`
  - card: `{ id, integration_id, card_name, card_number, masked_card_number, is_scrap_available, last_scrap_status }`
  - 최대 20장입니다.
- **매출(오프라인 카드 매출, 여신금융협회 cardsales)**: `sales_evidence`의 `source='card'`입니다.
- 별도 `card_transactions` 테이블은 **만들지 않습니다**. 카드 사용 내역 자체가 매입 증빙이기 때문입니다. 카드 대금 결제(출금)는 입출금 쪽 거래로 따로 잡힙니다.

### 2.7 거래처 (partners)

데모 `partners`(js:90420–90560)에서 확인한 형태입니다.

```text
{ id, name, representative_name, business_number, business_entity_type('corporation'|…), business_status('registered'|'closed'|…),
  sales: bool, purchased: bool, business_type(업태), business_class(종목), address, phone_number, memo,
  representative_image_path, bank_accounts:[{id, bank_code, account_number, account_name, bankbook_image_path}],
  contacts:[{id, name, department, email}], primary_account_id,
  unsettled_sales_amount, unsettled_purchase_amount, last_transaction_at, created }
```

등록 폼(img:bdffbc338baa9a07645b)의 항목은 다음과 같습니다.

- **기본 정보**
  - 거래처 유형*: 사업자(법인·개인) / 비사업자(개인)
  - 거래처 구분*: 매출처, 매입처 체크박스
  - 거래처명*, 대표자명*: 한글이나 영문 최대 30자
  - 사업자등록번호*: "-" 없이 숫자만. `조회하기` 버튼은 `GET /partner/scrap/business-status?business_number=`를 부릅니다.
  - 업태, 종목, 사업장 주소(주소 검색), 사업장 전화번호
  - 사업자등록증 사본: 10MB 이하 JPG, PNG, PDF
- **계좌 정보**: 은행명, 계좌번호, 계좌별명, 통장사본 첨부, 주거래용 여부. 여러 개를 추가할 수 있습니다.
- **담당자 정보**: 담당자명, 부서명, 이메일, 전화번호, 휴대폰번호, 팩스번호. 여러 개를 추가할 수 있습니다.
- **메모**: 최대 1,000자

목록(img:941795c8cd174badd773)의 컬럼은 등록일↓, 거래처명, 사업자등록번호, 대표자명, 메모입니다. 검색 대상은 거래처명, 대표자, 사업자번호, 메모이고, 20개씩 페이지를 나눕니다.

**미정산 금액(실시간)**은 다음과 같이 계산합니다. 데모 필드명은 `unsettled_sales_amount`, `unsettled_purchase_amount`입니다(추정 정의).

```text
unsettled_sales_amount    = Σ sales_evidence.total_amount (partner_id=p, 분류 계정이 '매출' 계열)
                          − Σ settlement_links.amount (sales 측, 해당 증빙)
unsettled_purchase_amount = 매입 측 동일
```

상세 탭은 "매출 정산 이력"과 "매입 정산 이력"(`adjustment-history/{sales,purchase}`), 그리고 "입출금 이력"(`bank-transaction-history`, 해당 거래처로 분류된 bank_transactions)입니다. 결산 기반 미수·미지급(4.6절)과는 **다른 숫자**입니다.

첨부 업로드는 사전 서명 URL 방식입니다(확인). `GET /attachments/get-upload-url/?file_name=`로 업로드 URL을 받고, 클라이언트가 직접 PUT합니다. 응답 형태는 미확인이지만 `{ upload_url, file_path }`로 추정합니다. 기존 설계의 "다운로드는 항상 API 경유" 원칙과 충돌하므로, 서버 경유 업로드 방식으로 바꾸고 응답 키만 호환하는 쪽을 권합니다.

"회사 정보 공유"(`partner/share-company/send`, `share-histories/recent`)는 우리 회사 정보(사업자등록증, 통장사본, 주소, 이메일, 연락처)를 거래처에 보내는 기능입니다. 최근 공유 이력 데모(js:91262)의 형태는 다음과 같습니다.

```text
{ share_info:{ detail:{ address, email, phone_number } },
  representative_image:{ id, file_name, file_path }, bankbook_image:{ id, file_name, file_path } }
```

### 2.8 세금계산서 발급 (transaction-sales: 거래명세서와 발급 이력)

enum(js:89398–89428)은 다음과 같습니다.

| 이름 | 값 |
| --- | --- |
| `InvoiceClass` | `01` 세금계산서, `02` 수정세금계산서, `03` 계산서, `04` 수정계산서 |
| `InvoiceKind` | `01` 일반, `02` 영세율, `03` 위수탁, `04` 영세율위수탁 |
| `BuyerClass` | `01` 사업자번호, `02` 주민등록번호, `03` 외국인 |
| `ReceiptIssueClass`(purpose) | `01` 영수, `02` 청구 |
| `ModifyReason` | `01` 기재사항 착오정정, `02` 공급가액 변동, `03` 환입, `04` 계약 해제, `05` 내국신용장 사후개설, `06` 착오에 의한 이중발급. 현재 UI에서는 쓰지 않습니다 |

데모 목업 `createTransactionSale`(js:90590–90700)에서 확인한 거래명세서 형태입니다.

```text
SalesTransaction {
  id, company, created, modified,
  class_code, kind_code, buyer_class_code, write_date, description, cash, check_bill, note, crit,  // crit=외상미수금
  purpose, grand_total_amount, charge_total_amount(공급가액 합), tax_total_amount,
  supplier_business_number, supplier_branch_number, supplier_company_name, supplier_representative_name,
  supplier_address, supplier_business_type, supplier_business_class, supplier_email,
  supplier_contact_name, supplier_contact_part, supplier_mobile_number, supplier_phone_number,
  buyer_* (위와 동일 + buyer_email_sub),
  items: [{ id, month:'MM', day:'DD', name, specification, quantity, unit_price, supply_amount, tax_amount, description }],
  item_summary, item_count, invoice_count,
  latest_issue_invoice_type: 'normal', latest_issue_date,
  latest_issue_invoice: { id, issue_no, issue_datetime, is_detail_synced, ...invoice 필드, items },
  invoices: [IssuedInvoice]
}
IssuedInvoice = 거래명세서 필드 스냅샷 + { issue_no(국세청 승인번호), issue_datetime, is_detail_synced, items }
```

- 등록 폼(img:9a8d171e918a2958aec1)의 항목은 다음과 같습니다.
  - 과세형태: 과세(영세율 포함) / 면세. `class_code`의 01과 03에 대응합니다.
  - 구분: 일반 / 영세율
  - 공급자: 회사 정보로 미리 채웁니다.
  - 공급받는 자: 사업자등록번호, 주민등록번호, 외국인 중 하나. "거래처 불러오기" 모달이 있습니다.
  - 작성일자*, 비고
  - 품목 행: 월일*, 품목*, 규격, 수량, 단가, 합계금액, 공급가액*, 세액*, 비고
  - 결제 수단: 현금, 수표, 어음, 외상미수금
  - 이 금액을 영수 / 청구
- 목록(img:d6fa0dbc095dc6322330)의 구성은 다음과 같습니다.
  - 월 선택, 검색(거래처, 대표자, 품목명), 엑셀 저장
  - 탭: `전체 / 발급 필요 / 발급 완료`
  - 요약 카드: 거래명세서 매출 총합계, 세금계산서 매출 총합계, 발급 필요 금액
  - 컬럼: 거래 등록일자↕, 작성일자↕, 거래처, 품목, 합계금액 …
  - 요약 응답(데모, 확인): `{ total_transaction_count, total_transaction_amount, total_invoice_count, total_invoice_amount }`. 여기서 **발급 필요 금액 = total_transaction_amount − total_invoice_amount**입니다(추정).
- 제약은 다음과 같습니다.
  - 위수탁은 미지원입니다.
  - 발급 후 수정 발행은 미지원입니다. 그러므로 `invoice_count ≥ 1`이면 PATCH와 DELETE에 409를 돌려준다고 추정합니다.
  - 조회는 홈택스 인증서를 등록한 당해 연도분만 가능합니다.

```sql
CREATE TABLE sales_transactions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, partner_id TEXT,
  class_code TEXT NOT NULL, kind_code TEXT NOT NULL, buyer_class_code TEXT NOT NULL, purpose TEXT NOT NULL,
  write_date TEXT NOT NULL, description TEXT, cash INTEGER, check_bill INTEGER, note INTEGER, crit INTEGER,
  supplier TEXT NOT NULL CHECK (json_valid(supplier)), buyer TEXT NOT NULL CHECK (json_valid(buyer)),
  grand_total_amount INTEGER NOT NULL, charge_total_amount INTEGER NOT NULL, tax_total_amount INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, UNIQUE (company_id, id)) STRICT;
CREATE TABLE sales_transaction_items (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, seq INTEGER NOT NULL,
  month TEXT NOT NULL, day TEXT NOT NULL, name TEXT NOT NULL, specification TEXT, quantity TEXT, unit_price INTEGER,
  supply_amount INTEGER NOT NULL, tax_amount INTEGER NOT NULL, description TEXT) STRICT;
CREATE TABLE issued_invoices (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
  issue_type TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL, issue_no TEXT, issue_datetime TEXT,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)), is_detail_synced INTEGER NOT NULL DEFAULT 0,
  error_code TEXT, error_message TEXT, created_at TEXT NOT NULL) STRICT;
```

`supplier`와 `buyer`를 JSON으로 둔 이유는 발급 시점 스냅샷이고 검색 키는 거래처명뿐이기 때문입니다. 발급에 성공한 건은 홈택스 수집 때 `sales_evidence(source='tax_invoice')`로도 들어옵니다. `issue_no`가 같으면 `sales_evidence.sales_transaction_id`로 연결하고, **합계는 sales_evidence 쪽만** 셉니다.

### 2.9 지로 고지서 (giros)

데모 목업 `createNationalTaxGiro` / `createLocalTaxGiro`(js:89770–89838)에서 확인한 형태입니다.

```text
Giro { id, company, created, modified, memo, status, status_updated_at,
  last_action_history: { id, created, modified, giro, status, memo, username, approver_username },
  slip_type: '국세고지내역조회_사업자번호' | '지방세고지내역조회_법인번호' | …,
  giro_type: '국세' | '지방세',
  detail(국세): { bill_org_name, e_pay_no(전자납부번호 19자리), biz_no, pay_amount, pay_amount1, pay_amount2,
                 pay_date1(납기내), pay_date2(납기후), payer_name, tax_name },
  detail(지방세): { bill_org_name, e_pay_no, pay_amount, pay_date, payer_name, tax1..tax4, tax_base, tax_sum, tax_name, tax_ym } }
```

금액은 문자열로 옵니다. 데모 값이 `"100000"`이기 때문입니다. 새 스키마는 INTEGER로 두고 직렬화할 때 문자열로 바꿉니다. `detail`은 원천 형식이 기관마다 달라서 JSON으로 저장합니다.

- 목록 화면(img:57762d2572e4ae7a8003)
  - 탭: `전체 / 납부 필요 / 확인 필요 / 납부 완료`
  - 검색: 세금명, 전자납부번호
  - 컬럼: [법인|사업자 배지] 세금명, 납부 금액(ⓘ), 상태(납부 필요 / 확인 필요 / 납부 완료 / **수동 완료**), [납부하기]
  - 10개씩 페이지를 나눕니다.
- 납부 모달
  - 출금 계좌를 고릅니다. 후보는 최근 입력 계좌, 서비스에 등록된 계좌, 직접 입력입니다.
  - 계좌 비밀번호를 받지만 **저장하지 않습니다**.
  - 안내 문구: 씨티·산업은행은 관세 납부 불가, 케이뱅크는 지방세·세외수입만 가능, 00:30–23:30 납부 가능(일부 은행은 07:00부터)
- 요약 응답(데모, 확인): `{ todo, unknown, done, hidden }` 건수

```sql
CREATE TABLE giros (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, e_pay_no TEXT NOT NULL,
  giro_type TEXT NOT NULL CHECK (giro_type IN ('국세','지방세')), slip_type TEXT NOT NULL,
  tax_name TEXT NOT NULL, bill_org_name TEXT, pay_amount INTEGER NOT NULL, due_date TEXT,   -- 국세 pay_date1 / 지방세 pay_date
  detail TEXT NOT NULL CHECK (json_valid(detail)),
  status TEXT NOT NULL CHECK (status IN ('todo','unknown','done','hidden')),
  done_reason TEXT CHECK (done_reason IN ('paid_in_app','manual','scraped')),             -- '수동 완료' 표시용
  memo TEXT NOT NULL DEFAULT '', status_updated_at TEXT NOT NULL, created_at TEXT NOT NULL, modified_at TEXT NOT NULL,
  UNIQUE (company_id, e_pay_no)) STRICT;
CREATE TABLE giro_actions (id TEXT PRIMARY KEY, giro_id TEXT NOT NULL, status TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL, approver_username TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL) STRICT;
CREATE TABLE giro_payments (id TEXT PRIMARY KEY, giro_id TEXT NOT NULL, bank_code TEXT NOT NULL, account_number TEXT NOT NULL,
  amount INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('requested','succeeded','failed')),
  result_code TEXT, result_message TEXT, requested_by TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
```

`giro_payments`에는 비밀번호 컬럼을 두지 않습니다.

### 2.10 낼 세금 알림

근거는 M:03-경리/07/01입니다.

| 종류 | 트리거 | 빈도 |
| --- | --- | --- |
| 세금 납부 알림 | 평일 09:30, `status='todo'`이고 `due_date − today ∈ [0,3]` | 매 영업일 |
| 인증서 만료 알림 | 지로 연동 인증서 `end_date − today = 30` | 1회 |
| 세금조회 불가 알림 | 지로 스크래핑이 인증 실패(인증서 만료나 인터넷지로 탈퇴) | **최초 1회**. 성공할 때까지 다시 보내지 않음 |

- 대상은 지로 연동을 마친 회사뿐입니다. 수신자는 담당자가 지정하고, 수신 거부도 담당자를 통해 처리합니다. 그래서 `notification_subscriptions(company_id, user_id, kind, enabled)`를 desk에서 관리합니다.
- 원천세와 법인세는 담당자의 "납부 마감 알림"과 겹쳐서 두 번 갈 수 있다고 매뉴얼에 명시돼 있습니다. 중복을 없애지 않는 것이 현행 동작입니다.
- 발송 기록 `notification_deliveries(kind, giro_id|cert_id, sent_on)`를 UNIQUE로 묶어 같은 날 재발송을 막습니다.

### 2.11 결산 스냅샷 (세무 보고서용, 담당자 업로드)

번들 응답 형태(데모)를 그대로 저장할 수 있게 둡니다. 원천은 세무사랑 ERP이고, 담당자가 "보고서 업데이트"를 누를 때 들어옵니다.

```sql
CREATE TABLE settlement_closings (company_id TEXT NOT NULL, fiscal_year INTEGER NOT NULL,
  closed_through TEXT NOT NULL,      -- 최종 결산 기준일(closing_date)
  scope TEXT NOT NULL CHECK (scope IN ('pl','bs','cash','ar_ap')), updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
  PRIMARY KEY (company_id, fiscal_year, scope)) STRICT;
CREATE TABLE settlement_pl_lines (company_id TEXT NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL,
  section TEXT NOT NULL,             -- 매출액|매출원가|매출총이익|판매비와관리비|영업이익|영업외수익|영업외비용|법인세등|당기순이익
  path TEXT NOT NULL,                -- '' = 섹션 합계, '상품매출' 또는 '매출원가/기초제품재고액' (계층)
  amount INTEGER NOT NULL, PRIMARY KEY (company_id, year, month, section, path)) STRICT;
CREATE TABLE settlement_bs_lines (company_id TEXT NOT NULL, target_month TEXT NOT NULL,  -- 'YYYY-MM-01'
  subject TEXT NOT NULL, parent_subject TEXT, sort_order INTEGER NOT NULL, amount INTEGER NOT NULL,
  PRIMARY KEY (company_id, target_month, subject)) STRICT;
CREATE TABLE settlement_cash_ledger (company_id TEXT NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL,
  cash_account TEXT NOT NULL CHECK (cash_account IN ('현금','당좌예금','보통예금','제예금')),
  inflow INTEGER NOT NULL, outflow INTEGER NOT NULL, closing_balance INTEGER NOT NULL,
  PRIMARY KEY (company_id, year, month, cash_account)) STRICT;
CREATE TABLE settlement_cash_entries (...)       -- 계정별 원장 행(엑셀 다운로드용): date, cash_account, summary, inflow, outflow, balance
CREATE TABLE settlement_partner_balances (company_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('receivable','payable')),
  year INTEGER NOT NULL, month INTEGER NOT NULL, erp_partner_code TEXT NOT NULL, partner_name TEXT NOT NULL,
  summary TEXT, entry_count INTEGER NOT NULL, rollover_balance INTEGER NOT NULL,
  increase_amount INTEGER NOT NULL, decrease_amount INTEGER NOT NULL, balance INTEGER NOT NULL,
  PRIMARY KEY (company_id, kind, year, month, erp_partner_code)) STRICT;
CREATE TABLE settlement_partner_entries (company_id TEXT NOT NULL, kind TEXT NOT NULL, year INTEGER NOT NULL,
  erp_partner_code TEXT NOT NULL, seq INTEGER NOT NULL, date TEXT NOT NULL, summary TEXT, transaction_amount INTEGER NOT NULL,
  balance INTEGER NOT NULL, PRIMARY KEY (company_id, kind, year, erp_partner_code, seq)) STRICT;
```

- 업로드 한 번은 `(company, year, scope)` 단위로 **전량 교체**합니다. 결산 수정은 덮어쓰기로 처리합니다.
- ERP 거래처 코드는 앱 `partners.id`와 매핑되지 않습니다. 응답의 `partner_id`는 ERP 코드를 정수로 바꾼 값이나 대리 키입니다(미확인).
- 인건비 내역은 결산 스냅샷이 아니라 **급여 도메인**의 마감 카드에서 읽습니다(4.8절). 담당 노트는 payroll.md입니다.

---

## 3. 상태와 전이

### 3.1 분류 상태 (증빙·입출금 공통)

```text
unclassified (account_title_id NULL) ──수동 선택──▶ classified(manual)
unclassified ──신규 수집 시 규칙 매칭 / 이전 거래 적용(fill_empty)──▶ classified(rule, rule_id)
classified(rule) ──수동 변경──▶ classified(manual)       (규칙 아이콘 사라짐)
classified(*) ──이전 거래 적용(overwrite)──▶ classified(rule)
classified ──계정 삭제(move_to)──▶ classified(동일 classified_by, 새 계정)
```

- 화면 탭은 `분류 완료`(= NOT NULL)와 `미분류`/`분류 필요`(= NULL)입니다.
- 번들에는 이 상태를 나타내는 enum이 없습니다. 페이지 chunk 안에 있기 때문입니다.
- 서버 필터 값으로는 `classification_status=classified|unclassified`를 제안합니다.

### 3.2 거래명세서와 세금계산서 발급 (transaction-sales)

번들에서 확인한 값은 `is_issued_invoice`(bool 필터), `issue_invoice_type`, `invoice_type`(필터), `latest_issue_invoice_type: 'normal'`, `is_detail_synced`입니다.

```text
draft(invoice_count=0) ──POST publish (120s timeout)──▶ issuing ──홈택스 성공──▶ issued(issue_no, issue_datetime, is_detail_synced=false)
                                                            └─실패──▶ draft (+error)  [추정]
issued ──POST invoices/:invoiceId/sync──▶ issued(is_detail_synced=true)
```

화면 탭은 "발급 필요"(`is_issued_invoice=false`)와 "발급 완료"(`true`)입니다. 발급한 뒤에는 수정과 삭제가 막힌다고 추정합니다.

`issue_invoice_type` 값은 `normal` 하나만 확인했습니다. 수정 발행이 생기면 `modify`가 추가될 것으로 봅니다.

### 3.3 지로 고지서 (확인: 데모 상태값 `todo | unknown | done | hidden`, js:89839–89900, 91181–91189)

| status | 화면 | 진입 |
| --- | --- | --- |
| `todo` | 납부 필요 | 스크래핑으로 신규 고지가 들어왔고 미납인 경우 |
| `unknown` | 확인 필요 | 납부기한 초과, 청구기관 취소, 고지서 취소, 별도 직접 납부 등으로 고지 목록에서 사라진 경우(M:03-경리/07 FAQ) |
| `done` | 납부 완료 / 수동 완료 | 앱에서 납부에 성공했거나(`payment`), `manual_done`, 또는 재수집 때 납부가 확인된 경우 |
| `hidden` | (탭 없음, 숨김) | `POST /giros/:id/hide` |

전이는 다음과 같습니다.

```text
todo → done(payment 성공 | manual_done) ; todo → unknown(재수집 시 미존재/기한초과) ; unknown → done(manual_done)
todo|unknown → hidden(hide) ; [미확인] hidden → todo 복원 API 없음
```

- `last_action_history.status`의 시작값은 `created`입니다(확인).
- 이후 값은 `manual_done`, `hide`, `paid`, `pay_failed`로 추정합니다.
- `memo`는 항상 `""`로 보냅니다(확인).

### 3.4 스크래핑과 연동 상태 (공통)

- `ScrapRequestStatus`: `request | done | timeout` (js:89238)
- `last_scrap_status.status`: `success`, …
- `CertificateStatus`: `ACTIVE | EXPIRED | INACTIVE | UNREGISTERED`
- `IntegrationType`: `hometax | giro | cardsales | bank | creditcard | allra | speedbank | pg | delivery` (js:89170)

이 값들로 증빙 source를 매핑하면 다음과 같습니다.

| IntegrationType | 증빙 |
| --- | --- |
| hometax | 세금계산서와 현금영수증(매출·매입) |
| cardsales | 매출 card |
| creditcard | 매입 card |
| pg | 매출 pg |
| delivery | 매출 delivery |
| allra | 매출 mall |
| bank, speedbank | 입출금 |
| giro | 고지서 |

### 3.5 결산 보고서 가용 상태

`closing_list: [year, …]`(확인)은 결산 데이터가 있는 연도 목록이고, 연도 선택기에 씁니다. 목록이 비어 있으면 예시 데이터를 보여 줍니다.

---

## 4. 집계 규칙

### 4.0 원천 구분 (가장 중요)

| 보고서 | 원천 테이블 | 갱신 | 대상 |
| --- | --- | --- | --- |
| 홈 카드: 자금 현황(전일) | `bank_transactions`, `bank_balance_snapshots` | 새벽 수집 직후 (06:00 기준) | 전체 |
| 홈 카드: 손익 현황(이달) | 분류된 증빙 + 분류된 입출금 (4.1) | 분류 후 5~10분 | 전체 |
| 실시간 > 손익 현황 손익 탭 | 같음 | 같음 | 전체 |
| 실시간 > 손익 현황 매출·매입 탭 | `sales_evidence`, `purchase_evidence` (**분류 무관**, source별) | 수집 즉시 | 전체 |
| 실시간 > 자금 현황 | `bank_transactions`, `bank_accounts`, 스냅샷 | 수집 즉시 | 전체 |
| 거래처 미정산 | 증빙 + `settlement_links` | 즉시 | 전체 |
| 세무 > 손익계산서·비용 분석 | `settlement_pl_lines` | 담당자 업로드 | taxation |
| 세무 > 인건비 내역 | 급여 마감 카드 + 직원 (payroll/hr 도메인) | 급여카드 계산 완료 | taxation + HR 권한 |
| 세무 > 자금 흐름 | `settlement_cash_ledger` | 업로드 | 프리미엄 |
| 세무 > 미수·미지급 | `settlement_partner_*` | 업로드 | 프리미엄 |
| 세무 > 재무상태표 | `settlement_bs_lines` (+ 누적 매출은 `settlement_pl_lines`) | 업로드 | 프리미엄 |
| 예상 부가세 | 기존 설계 6절 | – | – |

### 4.1 실시간 손익 (손익 현황 > 손익 탭)

화면(img:d7eb8f888abf41fba796 왼쪽)의 구성은 다음과 같습니다.

- 연도 선택
- 월별 막대 차트. 시리즈는 매출, 영업외수익, 매출원가, 판매비와관리비, 영업외비용, 손익입니다.
- "누적보기" 토글
- 월별 손익계산서 표(전체 펼치기). 행은 매출▾, 매출원가▾, 매출총이익, 판매비와관리비▾, 영업이익, 영업외수익, 영업외비용, (당기순이익)이고, 펼치면 하위 계정이 나옵니다.

아래 집계 규칙은 **추정**입니다. 번들에 근거가 없고, 이중 계상을 막는 쪽으로 설계했습니다.

```text
line(category, month) =
    Σ sales_evidence.supply_amount(부호 포함)    where account.pl_category = category, written_on ∈ month
  + Σ purchase_evidence.supply_amount           where account.pl_category = category
  + Σ |bank_transactions.amount|·sign           where account.pl_category = category       (증빙 없는 비용·수익: 급여, 임대료, 이자 등)
  -- '거래대금' 그룹(매출대금 입금·매입대금 출금 등, pl_category='none')은 손익 제외 → 증빙과 입금이 이중 계상되지 않음
매출총이익 = 매출 − 매출원가
영업이익   = 매출총이익 − 판매비와관리비
손익(순이익) = 영업이익 + 영업외수익 − 영업외비용
```

- 금액 기준은 공급가액입니다. 부가세는 손익이 아니기 때문입니다. 카드처럼 공급가액이 없는 증빙은 기존 `splitVatFromTotal`로 나눕니다. 다만 면세나 간이 가맹점이면 total을 그대로 씁니다(미확인).
- 홈 카드의 "매출 / 비용 / 순이익"은 이번 달 값입니다. 매출은 `revenue`이고, 비용은 `cogs + sga + non_op_expense`이며 음수로 표시합니다.
- 미분류 건은 집계에서 뺍니다. 매뉴얼의 "분류 완료된 경우에만 조회"가 근거입니다.

### 4.2 매출·매입 현황 (손익 현황 > 매출·매입 탭)

근거는 img:d7eb8f888abf41fba796 오른쪽과 M:…/05입니다.

- **기간 단위**
  - 일: 7일, 30일, 직접(1~31일, 2022-01 이후)
  - 월: 올해, 3개월, 6개월, 12개월
  - 분기: 올해, 3년
  - 년: 3년, 5년
  - 응답에는 "조회 기간: start ~ end"를 표시합니다.
- **요약**: 매출 합계와 버킷당 평균, 매입 합계와 평균, 예상 손익 합계와 평균
- **매출·매입 요약 차트**: 버킷별 매출, 매입, 예상 손익(선)
- **매출 상세**: 시리즈는 전년도 매출(같은 버킷의 전년 값), 세금계산서, 신용카드, 현금영수증, PG/배달/쇼핑몰입니다. 매입 상세는 세금계산서, 신용카드, 현금영수증입니다.

```text
매출(bucket) = Σ sales_evidence.total_amount  (합계 대상 source, dedupe_group당 1건 — 기존 6절과 동일 규칙)
매입(bucket) = Σ purchase_evidence.total_amount
예상 손익     = 매출 − 매입
```

- 화면 안내문은 "PG 매출의 경우 현금영수증 발행 건에 대해서는 매출이 중복(PG, 현금영수증)으로 집계됩니다"입니다. 즉 **현행은 PG와 현금영수증의 중복을 없애지 않습니다**. 기존 설계의 `dedupe_group` 정책과 맞출지 결정해야 합니다(7절).
- 금액 기준이 합계금액(부가세 포함)인지는 미확인입니다. 요약 숫자로는 구분할 수 없습니다.

### 4.3 실시간 자금 현황

**일별 자금 탭**(img:dfda2ae39c6b6acfac49 왼쪽)은 날짜 하나를 기준으로 하고, 기본값은 어제입니다.

```text
시작 잔액 = Σ_visible_accounts closing_balance(date − 1)
입금액     = Σ amount where direction='deposit',   transacted_at ∈ date
출금액     = Σ amount where direction='withdrawal' (음수)
마감 잔액 = Σ closing_balance(date)
시작 대비  = 마감 − 시작
기타 잔액 변동 = 마감 − 시작 − 입금액 − 출금액     (이자 결산·스크래핑 누락·외화 환산 차이 등)
```

- 그룹 토글은 `계좌별 / 분류별`입니다. 분류별은 입금·출금 아래에 계정과목(미분류 포함)별 시작잔액·입금·출금·마감을 보여 줍니다.
- 계좌 상세 내역의 탭은 `전체 / 입금 / 출금`이고, 컬럼은 시간, 구분, 계좌, 거래처, 분류, 금액, 메모입니다.
- 대상 계좌는 입출금(`01`)과 외화(`31`) 중 `is_visible_on_cash_report=1`인 것입니다. 구 매뉴얼 기준으로 "입출금·외화 계좌 잔액으로 가용 현금"을 계산합니다.

**기간별 추이 탭**(img:dfda2ae39c6b6acfac49 오른쪽)의 구성은 다음과 같습니다.

- 단위: 월간, 분기별, 연간, 지난 3개월, 지난 6개월, 지난 12개월, 올해, 작년
- 차트: 입금액, 출금액, 마감 잔액(선)
- 표: 행은 시작 잔액, 입금액▸(펼치면 분류별), 출금액▸, 기타 변동(ⓘ), 마감 잔액이고 열은 버킷입니다.

구 자금 현황의 "입출금 내역 요약"(img:b98738c7f70c1741fdbf)은 기초 금액, 순 변동액, 기간 내 입금액(카테고리: 매출 대금, 카드사 정산, 정부지원금, PG 매출, 미분류 입금), 기간 내 출금액(원자재 구매, 급여, 임대료 지급, 설비 구매, 매출 취소), 기타 잔액 변동, 기말 금액으로 구성됩니다. 여기서 **카테고리는 `account_titles.cash_category`**입니다. 출금 그룹 안의 "매출 취소 +875,000"을 보면 카테고리 묶음이 방향과 별개입니다.

홈 카드 "자금 현황(전일)"은 입금, 출금, 현재 잔액(= 마감 잔액)을 보여 줍니다.

### 4.4 세무 > 손익계산서 (report/profit-loss)

응답 형태는 데모 `createProfitAndLossStatement`(js:75668)에서 확인했습니다.

```jsonc
{ "content": {
    "month_range": ["202501", "...", "202610"],           // 전년 1월 ~ 기준월
    "data": { "2026": { "1": {
        "매출액":       { "value": 5350006, "sub_list": { "상품매출": { "value": 5350006, "sub_list": {} } } },
        "매출원가":     { "value": 184545, "sub_list": { "제품매출원가": {...}, "기말제품재고액": {...}, "기초제품재고액": {...}, "당기제품제조원가": {...} } },
        "매출총이익":   { "value": ..., "sub_list": {} },
        "판매비와관리비": { "value": ..., "sub_list": { "직원급여": {...}, "복리후생비": {...}, "지급수수료": {...} } },
        "영업이익":     { "value": ..., "sub_list": {} },
        "영업외수익":   { "value": ..., "sub_list": { "이자수익": {...}, "잡이익": {...}, "국고보조금": {...} } },
        "영업외비용":   { "value": ..., "sub_list": { "이자비용": {...} } },
        "당기순이익":   { "value": ..., "sub_list": {} } } } },
    "updated": { "2025": "2026-01-10 14:36:45", "2026": "2026-11-10 14:36:45" } } }
```

- 클라이언트는 `disableConvertChildKeyList: ["sub_list"]`로 호출합니다(js:73189). 따라서 **`sub_list` 아래의 키(계정명, 한글)는 케이스 변환을 하지 않습니다**. 서버는 계정명을 그대로 키로 씁니다.
- 화면(img:9f661f5408ddf0de1589)에는 **소득세등**(법인이면 법인세등) 행이 있습니다. 데모 스키마에는 이 행이 없으므로 `"법인세등"` 섹션을 추가합니다. 섹션 키 목록은 계약으로 고정합니다.
- 계산식은 다음과 같습니다(M:…/08).

```text
총 수익 = 매출액 + 영업외수익
총 비용 = 매출원가 + 판매비와관리비 + 영업외비용 + 법인세등
총 손익(당기순이익) = 총 수익 − 총 비용
매출총이익 = 매출액 − 매출원가
영업이익 = 매출총이익 − 판매비와관리비
```

- 화면의 나머지 항목은 다음과 같습니다.
  - 연도 선택, 월/분기 토글, "업데이트 일시"(= `updated[year]`)
  - 손익현황 차트: 수익, 비용, 손익, 전년도 손익
  - 매출현황: 상위 5개 항목. 나머지는 "내역 더보기"로 봅니다.
  - 순이익: 전년도 순이익과 비교
  - 손익계산서 표: 당기 합계 + 1~12월
  - 상세 내역 다운로드(xlsx, 월과 분기 시트)
- 두 엔드포인트의 차이는 미확인입니다. `/:year/`는 그 해 데이터를, `/:year/month-range/`는 그 해를 끝으로 하는 13~24개월 범위를 돌려준다고 추정합니다. 데모는 둘에 같은 응답을 씁니다.

### 4.5 세무 > 비용 분석 (cost-details)

근거는 img:22f576b56eb2c4d9c9cc와 M:…/09입니다. 전용 엔드포인트는 번들에 없으므로 `profit-loss` 응답으로 계산한다고 추정합니다. 기능 키 `settlement_reports_profit_loss_cost_details`가 따로 있으므로 권한만 별도로 거는 구조로 봅니다.

```text
비용 현황 = 매출원가 + 판매비와관리비 + 영업외비용 + 법인세등(개인: 소득세등)
주요 비용 비율: 매출원가율 = 매출원가/매출액, 판관비율 = 판매비와관리비/매출액  (월별, 매출액 막대와 함께)
판매관리비 상세: 판관비 sub_list 당기 합계 내림차순 상위 5개 기본, '항목 변경하기'로 선택
복리후생비 사용률 = 복리후생비 / 인건비 × 100   (기준선 20%)
   인건비 = 판관비 중 급여성 계정(직원급여, 임원급여, 상여금, 잡급, 퇴직급여 …) 합  [계정 목록 추정]
비용내역 상세: 섹션별 당기·월별 표 + '비용 총합'
```

### 4.6 세무 > 미수·미지급 (accounting/settlement)

이 응답 형태는 모두 데모 `createAccountingDemoApi`(js:75764–75935)에서 확인했습니다. 금액은 **문자열**로 옵니다. `summary`만 숫자입니다.

| 엔드포인트 | 응답 |
| --- | --- |
| `GET …/receivable-payable/summary/` | `{ receivable_balance, payable_balance, latest_settlement_date, closing_list }` |
| `GET …/receivable-payable/:year/` | `{ monthly_receivable: [Item], monthly_payable: [Item] }`, `Item = { month, increase_amount, decrease_amount, balance, previous_month_roll_over_balance }` |
| `GET …/receivable-by-partner/:year/?page=` (payable 동일) | DRF `{count,next,previous,results:[{ partner_id, partner_name, summary, count, balance, increase_amount, decrease_amount, previous_month_roll_over_balance }]}` |
| `GET …/:kind-by-partner/:year/:partnerId/` (`kind ∈ receivable,payable`) | `{ name, year, balance, rollover_balance, item: [{ date, summary, transaction_amount, balance }] }` |

불변식은 다음과 같습니다.

```text
balance(m) = previous_month_roll_over_balance(m) + increase(m) − decrease(m)
previous_month_roll_over_balance(1월) = 전년 12월 balance
거래처 표(img:dab2f2c761e9a5b6c5da): 거래처명 | 내용(summary, "IT 서비스 및 컨설팅 외 1건") | 전년도 이월 잔액 | 증가액 | 감소액 | 잔액
  → 연간 표에서 previous_month_roll_over_balance는 '전년도 이월'(연초 잔액), increase/decrease는 연 누적
Σ partner.balance = 해당 연도 마지막 결산월 monthly_*.balance
상세 item: 날짜 오름차순 누적 잔액, 마지막 행 balance = 거래처 balance
```

### 4.7 세무 > 자금 흐름 (report/cash-flow)

| 엔드포인트 | 응답 (데모 확인, js:75573–75597) |
| --- | --- |
| `GET /report/cash-flow/summary/` | `{ closing_date, funds_held, closing_list }` |
| `GET /report/cash-flow/:year/` | `[{ month, inflow, effluent, unique_inflow, funds_held }]` (문자열) |

```text
대상 계정: 현금, 당좌예금, 보통예금, 제예금 (settlement_cash_ledger)
inflow(m)   = Σ_계정 inflow ;  effluent(m) = Σ outflow
unique_inflow(순유입) = inflow − effluent   (양수=순유입 노랑, 음수=순유출 파랑)
funds_held(m) = Σ_계정 closing_balance(m)    -- '보유자금'
보유자금(summary) = 최종결산일의 현금성자산 + 연내 만기 자산 (M:…/12)  → 후자 정의 미확인
```

`effluent`는 오타처럼 보이지만 클라이언트 계약이므로 그대로 둡니다. 엑셀은 현금성 자산별 계정별 원장 시트로 만듭니다.

### 4.8 세무 > 인건비 내역 (labor-cost)

번들에 전용 엔드포인트가 없습니다(신규 설계). 근거는 img:95139d85a0dd2e44f333과 M:…/10입니다.

- 인건비현황: 소득 형태별 월 금액(세전)입니다. 형태는 근로, 일용, 사업, 기타이고 총 인건비도 함께 줍니다. "누적으로 보기" 토글이 있습니다.
- 재직자 추이: 월별 재직자(선), 입사자, 퇴사자 수와 연평균을 보여 줍니다.
  - 휴직자는 재직자에 포함합니다.
  - 월 말일까지 근무한 퇴사자는 그 달 재직자로 셉니다. 예를 들어 12/31 퇴사는 12월 재직이고, 12/21 퇴사는 12월 퇴사자이면서 재직자에서 빠집니다.
  - 원천은 직원 관리 데이터이고 실시간으로 반영합니다. 근로소득 직원만 셉니다.
- 인건비 내역: 형태별 월·당기 총액과 지급 인원을 보여 줍니다.
- 갱신 규칙
  - 급여카드가 "계산 완료"되면 반영합니다.
  - 재계산을 시작하면 그 카드분이 **빠졌다가** 다시 완료되면 반영됩니다.
  - 추가 카드는 완료될 때 더합니다.
  - 따라서 집계는 `status='calculated'`인 카드만 대상으로 합니다.
- 접근 권한은 회사 관리자나 인사 메뉴 열람 권한입니다.

### 4.9 세무 > 재무상태표 (report/balance-sheet)

| 엔드포인트 | 응답 (데모 확인, js:75458–75570) |
| --- | --- |
| `GET /summary/` | `{ closing_date, assets, liabilities, equity, closing_list }` |
| `GET /chart/:year/` | `[{ name: ChartName, ratio, items: [{ target_date:'YYYY-MM-01', ratio }] }]`, `ratio`는 "12.34" 형식 문자열(%) |
| `GET /table/:year/` | `[{ target_date, items: [{ subject, amount, items: [{ subject, amount }] }] }]` |

`table` 항목의 subject 고정 순서는 다음과 같습니다.

- `자산`: `Ⅰ.유동자산`, `Ⅱ.비유동자산`
- `부채`: `Ⅰ.유동부채`, `Ⅱ.비유동부채`
- `자본`: `Ⅰ.자본금`, `Ⅱ.자본잉여금`, `Ⅲ.자본조정`, `Ⅳ.기타포괄손익누계액`, `Ⅴ.이익잉여금`
- `부채와자본`: 하위 항목 없음

`ChartName` 값(js:73167)은 한글 문자열 그대로 내려 줍니다. 계산식은 다음과 같습니다(M:…/13 기준 추정, 분모가 0이면 null).

```text
자기자본비율 = 자본/자산×100          부채비율 = 부채/자본×100          유동비율 = 유동자산/유동부채×100
총자본순이익률(ROA) = 누적 당기순이익/자산×100     자기자본순이익률(ROE) = 누적 당기순이익/자본×100
총자산회전율 = 누적 매출액/자산      재고자산회전율 = 누적 매출액/재고자산      매출채권회전율 = 누적 매출액/매출채권
  누적 = 해당 연도 1월 ~ 해당 월 (settlement_pl_lines 매출액·당기순이익)
  재고자산·매출채권은 bs 하위 계정(table의 2depth 아래) 필요 → settlement_bs_lines에 3depth까지 저장
```

`chart`의 최상위 `ratio`는 최종 결산월 값이라고 추정합니다.

---

## 5. 엔드포인트 표

경로는 모두 `/api/company/:cid` 기준입니다(예외는 따로 표시). "출처"는 sf, rm(remittance), nx(nexus) 중 하나입니다. "번들" 열은 번들 메서드명이고, "신규"는 신규 설계입니다.

### 5.1 번들에서 확인한 엔드포인트 (36행)

| # | 메서드 | 경로 | 출처 | 번들 메서드 | 용도 | 요청 | 응답 | 근거 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | GET | `/transaction-sales/summary` | rm | `getSalesTransactionSummary` | 명세서/발급 합계 | params(추정: `start_date,end_date,search`) | `{total_transaction_count,total_transaction_amount,total_invoice_count,total_invoice_amount}` 확인 | js:89430 |
| 2 | GET | `/transaction-sales/summary/issued-status` | rm | `getSalesTransactionIssuedStatusSummary` | 탭 건수 | params | 추정 `{all,issue_required,issued}` | js:89432 |
| 3 | GET | `/transaction-sales/` | rm | `getSalesTransactions` | 명세서 목록 | `search,start_date,end_date,sort,is_issued_invoice,issue_invoice_type,invoice_type,limit,offset` | `{count,results:[SalesTransaction 요약+latest_issue_*, item_count, invoice_count]}` 확인 | js:89436 |
| 4 | POST | `/transaction-sales/` | rm | `postSalesTransaction` | 명세서 등록 | SalesTransaction 본문(2.8) | 생성 객체 | js:89450 |
| 5 | PATCH | `/transaction-sales/:id` | rm | `patchSalesTransaction` | 수정(발급 전만) | 부분 본문 | 객체 | js:89452 |
| 6 | GET | `/transaction-sales/:id` | rm | `getSalesTransaction` | 상세 | – | SalesTransaction(+invoices) 확인 | js:89454 |
| 7 | DELETE | `/transaction-sales/:id` | rm | `deleteTransaction` | 삭제 | – | 204 | js:89456 |
| 8 | POST | `/transaction-sales/:id/invoices/publish` | rm | `postPublishInvoice` | 홈택스 발급 (timeout 120s) | 본문 없음 | 추정 IssuedInvoice | js:89458 |
| 9 | POST | `/transaction-sales/:id/invoices/:invoiceId/sync` | rm | `postSyncInvoiceDetail` | 발급 상세 동기화 (120s) | 없음 | 추정 IssuedInvoice | js:89464 |
| 10 | GET | `/transaction-sales/:id/invoices` | rm | `getInvoices` | 발급 이력 | – | `{count,results:[IssuedInvoice]}` 확인 | js:89470 |
| 11 | GET | `/accounting/settlement/receivable-payable/:year/` | sf | `getReceivablePayable` | 월별 미수/미지급 | – | 4.6 확인 | js:73131 |
| 12 | GET | `/accounting/settlement/receivable-by-partner/:year/` | sf | `getReceivableByPartner` | 거래처별 미수 | `page`(기본 1) | DRF 4.6 | js:73135 |
| 13 | GET | `/accounting/settlement/payable-by-partner/:year/` | sf | `getPayableByPartner` | 거래처별 미지급 | `page` | DRF | js:73142 |
| 14 | GET | `/accounting/settlement/receivable-payable/summary/` | sf | `getSummary` | 잔액 요약 | – | 4.6 | js:73149 |
| 15 | GET | `/accounting/settlement/:kind-by-partner/:year/:partnerId/` | sf | `getReceivablePayableDetailByPartner` | 거래처 원장 | – | 4.6 | js:73153 |
| 16 | GET | `/report/balance-sheet/summary/` | sf | `getFinancialPositionSummary` | 재무상태 요약 | – | 4.9 | js:73165 |
| 17 | GET | `/report/balance-sheet/chart/:year/` | sf | `getMonthlyFinancialPosition` | 지표 8종 | – | 4.9 | js:73178 |
| 18 | GET | `/report/balance-sheet/table/:year/` | sf | `getBalanceSheet` | 월별 재무상태표 | – | 4.9 | js:73180 |
| 19 | GET | `/report/cash-flow/summary/` | sf | `getCashFlowSummary` | 보유자금 | – | 4.7 | js:73182 |
| 20 | GET | `/report/cash-flow/:year/` | sf | `getMonthlyCashFlow` | 월별 자금흐름 | – | 4.7 | js:73184 |
| 21 | GET | `/report/profit-loss/:year/month-range/` | sf | `getProfitLossMonthRange` | 손익(범위) | – | 4.4 | js:73186 |
| 22 | GET | `/report/profit-loss/:year/` | sf | `getMonthlyProfitLoss` | 월 손익 | – (`sub_list` 하위 키 변환 안 함) | 4.4 | js:73188 |
| 23 | GET | `/giros/` | rm | `getGiros` | 고지서 목록 | `{...re}` 그대로. 데모는 `status`를 씀. 추정 `status,search,limit,offset` | `{count,results:[Giro]}` 확인 | js:89375 |
| 24 | GET | `/giros/:idOrRawQuery` | rm | `getGiro`, `getGirosWithRawQuery` | 상세 / raw 쿼리 목록 | `getGirosWithRawQuery`는 `?status=…` 문자열을 붙임(추정) | Giro | js:89377–89379 |
| 25 | POST | `/giros/:id/manual_done` | rm | `postManualDoneGiro` | 수동 완료 | `{memo:""}` | Giro | js:89380 |
| 26 | POST | `/giros/:id/hide` | rm | `postHideGiro` | 숨기기 | `{memo:""}` | Giro | js:89382 |
| 27 | POST | **`/api/v2/company/:cid/giros/:id/payment`** | rm | `postPayGiroV2` | 실시간 납부 (120s) | 본문 미확인. 추정 `{bank_code, account_number, account_password, amount}` | 추정 `{status, giro}` | js:89384 |
| 28 | GET | `/giros/summary` | rm | `getGiroSummary` | 탭 건수 | – | `{todo,unknown,done,hidden}` 확인 | js:89388 |
| 29 | GET | `/payment/?limit=&offset=` | nx | `getCompanyPayments` | **구독 결제 이력**(설정 > 서비스 및 결제). 경리 도메인이 아님. platform.md로 넘김 | – | DRF 추정 | js:72365 |
| 30 | GET | `/attachments/get-upload-url/` | rm | `getPartnerFileUploadUrl` | 거래처 첨부 업로드 URL | `file_name` | 추정 `{upload_url,file_path}` | js:89495 |
| 31 | GET | `/partner/scrap/business-status` | rm | `getBusinessStatus` | 휴·폐업 조회 | `business_number` | 추정 `{business_status:'registered'|'suspended'|'closed', taxation_type, closed_on}` | js:89499 |
| 32 | GET | `/share-histories/recent` | rm | `getRecentShareHistory` | 최근 회사정보 공유 | – | 2.7 확인 | js:89503 |
| 33 | POST | `/partner/share-company/send` | rm | `postShareCompany` | 회사정보 공유 발송 | 추정 `{receivers:[email], detail:{address,email,phone_number}, representative_image_id, bankbook_image_id}` | – | js:89505 |
| 34 | GET | `/home/ssb/meta` | nx | `getSsbMeta` | 홈 메타(용도 미확인, 7절) | – | – | js:66746 |
| 35 | GET / POST | `/get-business_types`, `/update-business_types` | rm | `getBusinessTypes`, `postUpdateBusinessTypes` | 회사 업태·종목 조회 / 홈택스에서 재수집 | POST 본문 없음 | 추정 `[{business_type, business_class, code, is_main}]` | js:89485–89488 |
| 36 | GET | **`/api/bk-works/bk-schedules/current_year_end/`** | sf | `getIsYearEndSettPeriod` | 연말정산 기간 여부(회사 무관). payroll.md 소관 | – | 추정 `{is_period, start, end}` | js:72896 |

참고로 같은 remittance 모듈 안에 있는 연동 API는 `integrations/*`와 `cert/*`입니다(js:89195–89340). 경리 화면의 새로고침과 연동 상태에 쓰이지만 platform.md 소관이라 여기서는 목록만 적습니다.

- `GET integrations/v2/?integration_type=`
- `GET|POST integrations/bank/`, `GET integrations/bank/:integrationId?is_active=`, `PATCH integrations/bank/accounts`, `DELETE integrations/bank/:integrationId/:accountId`, `POST integrations/bank/request-bank-list`
- `creditcard` 동일 계열, `PUT integrations/creditcard/:iid/:cardId {card_number}`
- `POST integrations/cardsales/ {account_id, account_pw}`, `POST integrations/giro/`, `POST cert/:certId/join/giro`
- `POST integrations/request-scrapping/:service {corporation_number_unused}`, `POST integrations/request-all-scrapping/`, `GET integrations/scraping-status/?id=`, `GET integrations/status/?integration_type=`, `GET integrations/:service/last-scrap-request-status`

`PATCH integrations/bank/accounts`는 계좌 별칭과 `is_visible_on_cash_report`를 바꾸는 데 쓴다고 추정합니다.

### 5.2 신규 설계 (모두 `/api/company/:cid`, rm 계열 경로 규칙 준용)

| # | 메서드 | 경로 | 용도 | 요청 | 응답 |
| --- | --- | --- | --- | --- | --- |
| N1 | GET | `/evidence/:side/` (`side ∈ sales,purchase`) | 증빙 목록 | `source`(tax_invoice, card, cash_receipt, pg, delivery, mall), `start_date,end_date`(월), `classification_status`, `account_title_id`(복수), `doc_type`, `kind`, `search`, `sort`(`-written_on`, `total_amount`, `issued_on`), `limit,offset` | `{count,next,previous,results:[Evidence], counts:{all,classified,unclassified}}` |
| N2 | GET | `/evidence/:side/:id/` | 상세(품목 행 포함) | – | Evidence + `items[]` |
| N3 | PATCH | `/evidence/:side/:id/` | 분류·거래처·메모·공제 여부 | `{account_title_id?, partner_id?, memo?, deductible?}` | Evidence (`classified_by='manual'`) |
| N4 | POST | `/evidence/:side/bulk-classify/` | 일괄 분류 | `{ids[], account_title_id?, partner_id?}` | `{updated}` |
| N5 | GET | `/evidence/:side/export/` | 엑셀 | N1 필터 | xlsx |
| N6 | GET | `/bank/accounts/` | 계좌 목록과 요약 | `include_inactive` | `{summary:{account_count,total_assets,assets_by_type:{…},total_liabilities}, accounts:[BankAccount + fx_rate]}` |
| N7 | GET | `/bank/transactions/` | 입출금 목록 | `start_date,end_date, direction, account_id[], account_title_id[], classification_status, partner_id, search, sort, limit, offset` | DRF + `totals:{deposit,withdrawal,net}`, `counts` |
| N8 | PATCH | `/bank/transactions/:id/` | 분류·거래처·메모 | `{account_title_id?, partner_id?, memo?}` | Tx |
| N9 | POST | `/bank/transactions/bulk-classify/` | 일괄 | N4와 같음 | |
| N10 | GET | `/bank/transactions/export/` | 엑셀 | N7 필터 | xlsx |
| N11 | POST / DELETE | `/bank/transactions/:id/settlements/` | 증빙 매칭 / 해제 | `[{evidence_side, evidence_id, amount}]` | links + `settlement_status` |
| N12 | GET | `/account-titles/` | 계정과목 트리 | `applies_to`(sales, purchase, deposit, withdrawal), `search` | 3단 트리 |
| N13 | POST | `/account-titles/` | 하위 계정 추가 | `{parent_id, name, description?}` | 생성 + `auto_created_etc?` |
| N14 | PATCH | `/account-titles/:id/` | 이름·설명 수정(회사 계정만) | | |
| N15 | DELETE | `/account-titles/:id/` | 삭제 + 재분류 | `{move_to_id}` (거래가 있으면 필수, 없으면 422) | `{moved}` |
| N16 | GET | `/classification-rules/?scope=` | 규칙 목록(우선순위 순) | `include_hidden` | `[Rule]` |
| N17 | POST | `/classification-rules/` | 생성(맨 아래에 붙임) | `{scope,name,conditions,result_account_title_id?,result_partner_id?}` | Rule |
| N18 | PATCH / DELETE | `/classification-rules/:id/` | 수정 / 숨김(`is_hidden`) / 삭제 | | |
| N19 | PUT | `/classification-rules/order/` | 순서 변경 | `{scope, ids:[…]}` | |
| N20 | POST | `/classification-rules/preview/` | 미리보기 | `{scope, source?, conditions, limit, offset}` | DRF 매칭 거래 |
| N21 | POST | `/classification-rules/apply/` | 이전 거래에 적용 | `{scope, mode:'fill_empty'|'overwrite'}` | `202 {job_id}` |
| N22 | GET | `/classification-rules/apply/:jobId/` | 진행률 | | `{status,total,processed}` |
| N23 | GET / POST | `/partners/` | 목록(검색, 페이지) / 등록 | 2.7 필드 | DRF / Partner |
| N24 | GET / PATCH / DELETE | `/partners/:id/` | 상세 / 수정 / 삭제 | | Partner (+unsettled_*) |
| N25 | GET | `/partners/:id/adjustment-history/:side/` | 거래처 증빙과 정산 이력 | `year`, 페이지 | DRF `[evidence + settled_amount + remaining]` |
| N26 | GET | `/partners/:id/bank-transactions/` | 거래처 입출금 이력 | 기간, 페이지 | DRF |
| N27 | GET | `/reports/profit-loss/status/?year=` | 실시간 손익(4.1) | `year`, `cumulative` | `{months:[{month, revenue, cogs, gross_profit, sga, operating_profit, non_op_income, non_op_expense, net_income, breakdown:{section:{account_name:amount}}}], updated_at}` |
| N28 | GET | `/reports/profit-loss/sales-purchase/` | 매출·매입(4.2) | `unit(day,month,quarter,year)`, `preset` 또는 `start,end` | `{period, totals:{sales,purchase,profit}, averages, buckets:[{key, sales, purchase, profit, sales_by_source{}, purchase_by_source{}, prev_year_sales}]}` |
| N29 | GET | `/reports/cash/daily/?date=` | 일별 자금(4.3) | `group_by(account,category)` | `{opening, deposit, withdrawal, other_change, closing, groups[], transactions[]}` |
| N30 | GET | `/reports/cash/period/` | 기간별 추이 | `unit, preset` | `{buckets:[{key, opening, deposit, withdrawal, other_change, closing, deposit_by_category{}, withdrawal_by_category{}}]}` |
| N31 | GET | `/home/summary-cards/` | 홈 경영 현황 3카드 | – | `{cash:{date,deposit,withdrawal,balance}, pl:{month,revenue,expense,net_income}, vat:{…기존 6절 축약, due_in_days}, as_of}` |
| N32 | GET | `/report/labor-cost/:year/` | 인건비 내역(4.8) | – | `{updated, monthly:[{month, wage, daily, business, other, total, headcount_by_type{}}], employees:[{month, employed, joined, left}], avg_employed}` |
| N33 | GET | `/report/:kind/:year/export/` | 세무 결산 엑셀(`kind`: profit-loss, cost-details, labor-cost, receivable-payable, cash-flow, balance-sheet) | | xlsx |
| N34 | PUT | `/api/desk/companies/:cid/settlements/:year/:scope/` | **담당자** 결산 업로드("보고서 업데이트") | ERP 내보내기 파일 또는 정규화 JSON | `{closed_through, updated_at}` |
| N35 | GET | `/giros/:id/payment-accounts/` | 납부 출금계좌 후보(최근 입력 + 등록 계좌) | | `[{bank_code, account_number, source:'recent'|'registered'}]` |

**신규 설계 메모**

- 기존 `/evidence` 화면은 `legacy` 라우트를 함께 갖고 있습니다. N1 하나로 두 화면을 모두 지원합니다.
- N27과 N28은 매뉴얼의 실시간 보고서 경로(`/reports/...`)를 따릅니다. 기존 설계의 `/reports/estimated-vat/`와 같은 네임스페이스입니다.
- 결산 계열(N32, N33)은 번들 관례대로 단수 `/report/`를 씁니다.

**합계**: 번들 확인 36개(동일 경로의 GET/POST 쌍과 raw 쿼리 변형을 한 행으로 셈, 메서드 단위로 세면 38개)와 신규 설계 35행(메서드 단위로 약 45개)입니다.

---

## 6. 외부 연동 경계

| 연동 | 방향 | 우리 서버 책임 | 외부(스크래퍼, 기관) 책임 | 메모 |
| --- | --- | --- | --- | --- |
| 홈택스 세금계산서·현금영수증 수집 | in | upsert(`external_key`), 규칙 적용, 집계 무효화 | 인증서와 ID로 조회 | 당해 연도분만 조회(매뉴얼) |
| 홈택스 전자세금계산서 **발급** | out | 명세서 → 발급 요청, `issued_invoices` 상태 관리, 120초 동기 대기 | 인증서 서명과 국세청 전송, 승인번호 | 인증서: 사업자 범용 또는 전자세금용(`certOIDs` usage `etax`, js:89560~). 매출·매입 조회용 홈택스 연동이 있으면 발급 연동도 자동으로 완료 |
| 발급 상세 sync | in | `is_detail_synced=true`, 증빙과 연결 | 발급분 상세 조회 | |
| 은행(+speedbank) | in | 계좌와 거래 upsert, 일별 잔액 스냅샷, 92일 소급 | 인증서 스크래핑 | 수동 새로고침 10분 쿨다운은 `scrap_requests`로 판정 |
| 카드(매입 creditcard / 매출 cardsales=여신협회) | in | 증빙 upsert | 스크래핑 | cardsales는 ID/PW 연동 |
| PG, 배달, 올라(쇼핑몰) | in | 증빙 upsert, `dedupe_group` | 스크래핑. PG와 배달은 "scrap-request" 신청 방식 | 홈 카드 안내 "PG·배달 매출은 11:00경 반영"으로 보아 배치가 별도 |
| 인터넷지로 조회 | in | `giros` upsert. 다시 수집했을 때 목록에서 사라진 todo는 `unknown`으로 전이 | 인증서로 고지 조회 | **사용자가 누를 때만** 실행. 자동 배치 없음 |
| 인터넷지로 **납부** | out | `giro_payments` 기록, 비밀번호는 전달만 하고 저장하지 않음, 성공하면 `done(paid_in_app)` | 금융결제원 출금 | 타임아웃 120초. 결과가 불확실하면 재조회로 정리(멱등키 `giro_id+request_id`) |
| 국세청 사업자 상태 | in | `partner/scrap/business-status` 프록시와 캐시 | 조회 | |
| 세무사랑 ERP | in(desk) | 결산 스냅샷 교체 | 담당자 내보내기 | N34 |
| 급여 시스템 | 내부 | 인건비 집계는 payroll이 제공하는 읽기 뷰를 사용 | – | payroll.md |
| 알림(카카오, 메일) | out | 4종 알림 스케줄 | 발송 채널 | platform.md 알림 모듈과 공유 |

스크래퍼와 기관 호출은 인터페이스(`EvidenceSource.fetch(companyId, range)`, `InvoiceIssuer.publish(tx)`, `GiroGateway.list/pay`) 뒤에 숨깁니다. 이렇게 하면 기존 설계처럼 테스트에서 가짜 구현을 끼울 수 있습니다.

---

## 7. 미확인 사항

1. **`/home/ssb/meta`의 의미.** nexus의 `alfredHome` 모듈에 있습니다. "ssb"는 홈 경영 현황 카드의 메타(기준 시각 "매일 06:00", PG·배달 11:00 반영 등)이거나, 소상공인 지원(Small Business) 배너일 수 있습니다. 응답 형태를 실측해야 합니다.
2. **`postPayGiroV2` 요청 본문.** 계좌 직접 입력 시 예금주 생년월일이나 사업자번호가 필요한지, v1과 무엇이 다른지 모릅니다.
3. **`getGiros` 파라미터.** `status` 외에 기간이나 검색이 있는지 모르고, DRF `next/previous`를 쓰는지도 모릅니다. 데모는 `{count, results}`만 씁니다. `getGirosWithRawQuery`가 `/giros/?…`처럼 쿼리 문자열을 경로에 붙이는 용도라고 추정하지만 확인이 필요합니다.
4. **`transaction-sales/summary/issued-status` 응답**과 `issue_invoice_type`·`invoice_type` 필터의 가능한 값을 모릅니다.
5. **`profit-loss/:year/`와 `/month-range/`의 차이.** `updated`와 `month_range`의 의미도 정확히 모릅니다.
6. **실시간 손익의 금액 기준.** 공급가액인지 합계인지 모르고, 입출금 분류분을 함께 넣는지(4.1의 이중 계상 방지 설계)도 현행 동작과 맞는지 모릅니다.
7. **매출·매입 현황의 중복 처리.** 현행은 PG와 현금영수증 중복을 허용합니다(화면 안내문). 기존 설계 6절은 `mall`과 `delivery`를 합계에서 제외합니다. 두 화면이 서로 다른 숫자를 내도 괜찮은지 제품 결정이 필요합니다.
8. **계정과목 체계 전체.** 1·2·3차 목록, 고유 코드, `applies_to` 태그 전체, 손익과 자금 카테고리 매핑을 모릅니다. 설정 화면을 전부 캡처하거나 API를 실측해야 합니다. 매입 증빙 드롭다운 그룹도 아직 보지 못했습니다.
9. **규칙의 세부.** 조건 연산자 전체 목록, 조건 간 OR 지원 여부, 규칙에 source 제한이 있는지, overwrite가 수동 분류도 덮는지, 거래처 결과만 있는 규칙이 가능한지 모릅니다.
10. **"증빙 연결" 상태값 전체**(화면에는 "거래처 필요"만 보임)와 매칭 UI(부분 매칭 가능 여부)를 모릅니다.
11. **결산 응답의 `partner_id`가 ERP 코드인지.** 상세 경로의 `:partnerId`가 같은 값인지도 확인해야 합니다.
12. **보유자금 정의의 "연내 만기 자산"**이 어느 BS 계정인지 모릅니다.
13. **재무 비율 계산식.** ROA와 ROE의 분자(누적 순이익인지 연환산인지), 재고자산회전율의 분자(매출액인지 매출원가인지)를 모릅니다. 매뉴얼은 "누적 매출액"만 언급합니다.
14. **엑셀 다운로드 형식.** 매뉴얼에 샘플 xlsx가 언급되지만 크롤링에 포함되지 않았습니다.
15. **세금계산서 발급 실패의 상태 표현.** `issued_invoices.status` 값과 재시도 정책을 모릅니다.
16. **외화 계좌의 잔액과 환율 원천**, 그리고 "외화 입출금 거래 금액"을 보여 주는 방식을 모릅니다.
17. **remittance-api와 sf-api 사이 데이터 소유권.** 증빙과 입출금 목록 API가 어느 백엔드에 있었는지 모릅니다. lazy chunk(`index-CPZ_b1bm.js` 등)를 받아서 확인해야 합니다.
18. **`/payment/`**: nexus의 구독 결제 이력으로 판단했습니다. 경리 범위 밖입니다.
19. **`/api/bk-works/bk-schedules/current_year_end/`**: 연말정산 기간 판정이며 payroll.md 범위입니다. 회사 id 없이 전역으로 호출합니다.
