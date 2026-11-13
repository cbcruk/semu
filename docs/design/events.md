# 도메인 이벤트와 컨텍스트 간 연계

컨텍스트 사이 통신에 쓰는 이벤트와 공개 조회를 정의합니다. 컨텍스트는 서로의 저장소를 읽지 않고, 이 문서의 두 경로로만 연결됩니다 ([conventions.md](conventions.md#코드-구조)).

## 현행에서 고칠 점

- **연계가 클라이언트 호출 순서에 달려 있습니다.** 급여대장 마감과 원천세 신고 항목 갱신, 전자서명 완료와 근로계약 생성이 서로 다른 요청이라 중간에 실패하면 어긋납니다
- **백엔드 세 곳이 같은 개념을 따로 가집니다.** nexus의 구독과 sf의 플랜 플래그가 따로 있어, 플랜 캐시(`tax_plan`, `has_payroll_plan`)를 매번 동기화해야 했습니다
- **실시간 알림이 없어 폴링합니다.** 수집 결과(`PROGRESS|SUCCESS|FAIL`), 전자서명 진행, 증명서 발송을 클라이언트가 반복 조회합니다

## 형식

모든 이벤트는 같은 envelope입니다. [CloudEvents](https://cloudevents.io/) 필드 이름을 따릅니다.

```jsonc
{
  "id": "evt_01J...",
  "type": "payroll_pay_month.closed",
  "time": "2026-11-10T18:02:11+09:00",
  "companyId": "cmp_01J...",
  "subject": "2026-10",                 // 주 리소스 ID 또는 키
  "seq": 18234,                          // 회사별 단조 증가
  "actor": { "kind": "AGENCY", "id": "usr_01J..." },
  "data": { "paymentMonth": "2026-10", "ledgerIds": ["pyl_01J..."] }
}
```

- **이름은 `<resource>.<event>`이고 둘 다 snake_case입니다.** 예: `filing.status_changed`, `esign_request.completed`
- `data`에는 소비자가 바로 반응하는 데 필요한 최소 필드만 넣습니다. 전체 리소스는 넣지 않고, 소비자가 ID로 다시 조회합니다
- **같은 리소스의 다른 변화는 다른 이벤트로 냅니다.** 예: 지급월(`payroll_pay_month`)은 대장이 모두 마감된 `closed`, 그것이 풀린 `reopened`와 별도로, 퇴직금 정산의 완료·다시 열기로 원천세 합계만 바뀐 `withholding_changed`를 냅니다(2026-11-08, [payroll.md 퇴직금 정산](payroll.md#퇴직금-정산)). 대장이 없는 달에도 낼 수 있어 `closed`·`reopened`의 뜻("대장이 모두 마감")을 넓히지 않았고, 정산 리소스 이벤트(`severance_settlement.completed`)로 내면 Tax가 정산을 알아야 하므로 Tax가 관심 있는 지급월을 리소스로 두었습니다. 소비자는 셋을 같은 채널(`payroll_pay_month->tax`)로 받아 같은 다시 맞춤을 합니다
- 주민등록번호·계좌번호·개인별 급여 금액은 이벤트에 넣지 않습니다 ([compliance.md](compliance.md#개인정보-최소-노출)). 회사 단위 합계는 넣을 수 있지만, 소비자가 언제 받아도 지금 값이 필요하면 조회로 줍니다. 예: 지급월 마감 이벤트는 원천세 합계를 싣지 않고 Tax가 `WithholdingTotals`로 묻습니다(2026-11-08, [payroll.md 열린 질문 15](payroll.md#열린-질문))

## 전달

### 컨텍스트 간 (서버 내부)

- 각 컨텍스트는 상태 변경과 같은 트랜잭션에서 **outbox**에 이벤트를 씁니다. 릴레이가 outbox를 읽어 버스에 냅니다
- 같은 프로세스 소비자는 "아직 전달되지 않았는지 확인 → 소비 처리 → 전달 표시"를 한 트랜잭션에서 하므로 한 번만 처리됩니다. 프로세스 밖 소비자(SSE, 외부 버스)가 생기면 이벤트 `id`로 중복을 걸러야 하므로(최소 1회 전달), 소비 처리는 처음부터 멱등으로 만듭니다. 예: 원천세의 급여대장 항목 갱신은 "그 달의 대장이 모두 마감됐는가"를 다시 계산할 뿐입니다
- **지금 구현:** SQLite 저장소에서는 `outbox` 표에 쓰고 커밋 뒤 같은 프로세스의 소비자에게 넘깁니다. 실패한 전달은 시작할 때와 30초마다 릴레이가 다시 넘깁니다(`src/shared/persistence/outbox.ts`). 메모리 저장소에서는 바로 소비자를 부릅니다. outbox를 거치는 연계는 지금 `payroll_pay_month.*` → Tax 하나이고, 소비자가 없는 `TaxEvents`·`DocumentEvents`는 아직 메모리 로그입니다. 연결은 `apps/api/src/wiring/`에 있습니다

### 단말 (실시간)

```
POST /events/stream-tickets               → { ticket, expiresAt }
GET  /events/stream?ticket=…&since=18200  Server-Sent Events
```

- hemr와 같이 SSE를 쓰고, 액세스 토큰 대신 60초짜리 1회용 티켓으로 연결합니다. 쿼리스트링에 토큰을 실으면 프록시·접근 로그에 남기 때문입니다
- 클라이언트는 마지막 `seq`를 `since`로 보내 빠진 이벤트를 다시 받습니다. 보관 기간(24시간)을 넘었으면 서버가 `reset`을 보내 전체 재조회를 지시합니다
- 서버는 행위자의 권한에 맞는 이벤트만 보냅니다. 예: `payroll-ledger:read`가 없는 사용자에게는 급여 이벤트를 보내지 않습니다
- **지금 구현:** 없습니다. 수집·전자서명 진행은 아직 `GET`으로 확인합니다

## 이벤트 목록

| 컨텍스트 | 이벤트 | 소비자 | 상태 |
|---|---|---|---|
| Identity & Access | `member.access_changed`, `member.removed`, `company.updated`, `terms.agreed` | 단말(메뉴 다시 그리기). 권한이 바뀐 사용자의 액세스 토큰은 발행 즉시 폐기 | 설계. 토큰 폐기만 구현 |
| Billing | `subscription.changed` | Identity & Access(플랜 반영, 토큰 폐기) | 설계. 지금은 `CompanyPlans` 조회로 반영되어 최대 액세스 토큰 수명(10분)만큼 늦음 |
| Billing | `payment.scheduled`, `payment.failed`, `service_contract.signed` | 단말, 세무 대리인 알림 | 설계 |
| Integrations | `scrap_request.completed` (`job.completed`) | 단말 | 설계. 수집 레코드 자체는 이벤트가 아니라 `ScrapedRecordIngestion` 호출로 넘김(아래) |
| Tax | `filing.status_changed` | 단말, 알림. Payroll은 받지 않고 대장 잠금을 `WithholdingFilingLock` 조회로 판정하며, 할 일 카드는 같은 요청 안에서 바뀜 | 구현(메모리 발행), 소비자 없음 |
| HR | `employee.joined`, `employee.resigned`, `leave.started`, `leave.ended` | Payroll(명단 변경 경고), Documents | 설계 |
| Documents | `esign_request.sent`, `esign_request.completed`, `esign_request.voided`, `certificate.issued` | HR(완료본을 문서 보관함에 넣고 확정한 근로·급여계약에 연결, 무효면 풂) | `completed`·`voided` 구현(outbox `esign_request->hr`). `sent`·`certificate.issued`는 받는 곳이 없어 버림 |
| Payroll | `payroll_pay_month.closed`, `payroll_pay_month.reopened`, `payroll_pay_month.withholding_changed` | Tax(원천세 신고의 급여대장 항목 `provided` 판정을 다시 맞춤) | 구현(outbox) |
| Bookkeeping | `evidence.ingested`, `tax_invoice.issued`, `giro.paid` | 단말, Tax(예상 부가세 갱신 알림) | 설계 |
| 공통 | `job.completed`, `reset` | 단말 | 설계 |

## 공개 조회

이벤트로 넘기기 어려운 "지금 값"은 제공하는 컨텍스트가 `<context>.public.ts`에 조회 서비스로 내보내고, 쓰는 컨텍스트는 자기 말로 선언한 포트로 받습니다. 둘을 잇는 어댑터는 `apps/api/src/wiring/`에 있습니다.

| 쓰는 쪽 포트 | 제공 쪽 공개 서비스 | 내용 |
|---|---|---|
| Identity & Access `CompanyPlans` | Billing 구독 | 회사의 유효 플랜. `Actor.plans`의 원천 |
| Tax `TaxCompanies` | Identity & Access 회사 + Billing 플랜 | 사업자 형태, 플랜. 결산월 등 세무 설정은 Tax 자기 저장소(`tax_settings`)에 있고 Tax가 합쳐 신고 일정 계산 입력(`TaxProfile`)을 만듦 |
| Tax `PayrollLedgers` | Payroll `PayrollLedgerSummary` | 지급월 범위의 대장 수와 마감 수 |
| Tax `WithholdingTotals` | Payroll `PayrollWithholdingTotals` | 지급월의 마감 대장 소득 종류별 원천세 합계. Tax가 신고서 줄 코드로 바꿈 |
| Payroll `WithholdingFilingLock` | Tax `WithholdingFilingLock` | 지급월 원천세가 `FILED`·`SETTLED`인지. 참이면 대장 변경 409 |
| Payroll `PayrollEmployeeDirectory` | HR `HrDirectory` | 기간 중 재직한 근로자, 계약·4대보험·공제 정보 |
| HR `SeveranceSettlementLookup` | Payroll `SeveranceSettlementQuery` | 직원의 퇴직금 정산 상태 전부. `COMPLETED`가 있으면 직원 삭제·퇴사 취소·다시 퇴사 409 |
| Documents (직접) | HR `HrDirectory` | 서명 요청 수신자, 증명서 대상 직원 |
| Tax `VatEvidence` | Bookkeeping `VatEvidenceQuery` | 과세기간의 매출·매입 증빙 |
| Bookkeeping `VatEstimateSource` | Tax 예상 부가세 | 홈 요약의 예상 납부세액과 기한 |
| Identity & Access `AgencyWorkload` | Tax `AgencyWorkloadQuery` | 대리인 담당 회사별 미결 신고 건·기한 경과·진행중 카드 수 ([agency-queue.md](agency-queue.md)) |
| Bookkeeping `LaborCostSource` | Payroll `PayrollLaborCost` | 월별 인건비와 인원 |
| Bookkeeping `BusinessStatusLookup`, `HometaxInvoiceIssuer`, `GiroPaymentGateway` | Integrations | 국세청 상태조회, 세금계산서 발행, 지로 납부 |
| Integrations `ScrapedRecordSink` | Bookkeeping `ScrapedRecordIngestion` | 수집 레코드 저장. `externalKey`로 멱등 |
| Tax·Billing `PublicHolidays` | 공용 공휴일 데이터 | 신고 기한·출금일 이월 |
