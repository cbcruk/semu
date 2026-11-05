# Assistant 규칙 결정

[assistant.md](../assistant.md)의 규칙 2개에 대한 결정입니다. 질문 번호는 각 픽스처의 `openQuestions` 순서입니다.

| 규칙 | 질문 | 따름 | 바꿈 | 보류 |
|---|---:|---:|---:|---:|
| [assistant-tool-access](../../reference/rules/assistant-tool-access.md) | 6 | 3 | 3 | 0 |
| [grant-recommendation](../../reference/rules/grant-recommendation.md) | 5 | 0 | 3 | 2 |

## assistant-tool-access

| # | 질문 | 결정 | 내용 |
|---|---|---|---|
| 1 | 시스템 관리자 전용(번들) vs 전체(매뉴얼) | 바꿈 | 모든 사용자가 `conversation:create`로 진입. 시스템 관리자 게이트를 없앰 |
| 2 | 무료 고객의 세금계산서 발행 | 바꿈 | 플랜 없이 `tax-invoice:issue` 권한으로 허용 (매뉴얼) |
| 3 | 직원·급여 조회가 세무 기장(매뉴얼) vs 급여 플랜(레거시) | 바꿈 | `TAXATION` 또는 `PAYROLL` 중 하나 + `payroll-ledger:read` |
| 4 | 멤버의 역할이 읽기 도구를 좁히는지 | 따름 | 레거시처럼 좁힘. 도구마다 같은 일을 하는 일반 API의 권한을 요구 |
| 5 | 쓰기 도구의 확인·감사 | 따름 | 비서는 제안만(`requiresConfirmation`). 실행은 클라이언트가 확인 후 일반 API로 하므로 감사·멱등성이 일반 요청과 같음 |
| 6 | 대화가 개인 것인지 회사 공유인지 | 따름 | 레거시대로 개인 것. 세무 대리인은 기본으로 비서에 들어오지 못함(D5, 레거시와 같음) |

### 바뀌는 케이스

| 케이스 | 현행 기대값 | 서버 기대값 |
|---|---|---|
| bundle: admin who is not the system admin is sent to /dashboard | `/dashboard` | 진입 |
| bundle: general member is sent to /dashboard | `/dashboard` | 진입 |
| legacy: free admin gets knowledge and finance summary only | 2개 | + `issue_tax_invoice` |
| legacy: taxation admin gets invoice and certificate tools | 4개 | + `lookup_payroll` |

`legacy: assigned agency staff cannot open the assistant menu`는 D5(2026-11-06) 전까지 진입으로 바꿨다가, 대리인 기본 권한에서 `conversation:*`를 빼면서 현행 기대값(`PERMISSION_DENIED`)으로 돌아왔습니다.

옮기지 않은 케이스: 홈 추천 질문 prefill(화면), 세금계산서 전제 조건(발행 API가 판정), 학습 외 답변 금지(모델 동작).

### 결정 기록

**진입 대상 (1)**

- 결정: 비서 진입은 `conversation:create` 하나로 판정하고, 기능 차이는 도구 목록으로 둡니다. `conversation:*`는 기본 권한이라 모든 사용자가 들어옵니다
- 검토한 대안: 시스템 관리자 전용 유지(번들). `ai_agent` 메뉴를 역할에 부여할 수 있는 권한으로 둠
- 선택 이유: 매뉴얼이 고객 안내 문서이고 "누구나 쓸 수 있나요? 네"라고 답합니다. 위험은 쓰기 도구에 있는데, 도구가 일반 API 권한을 그대로 요구하므로 진입을 넓혀도 권한이 넓어지지 않습니다
- 가정과 되돌릴 조건: 시스템 관리자 게이트가 베타 시기의 흔적이라는 가정입니다. LLM 비용 때문에 사용자를 제한해야 한다면 `conversation:create`를 기본 권한에서 빼고 역할 프리셋으로 옮깁니다

**도구 요건 (2, 3, 4)**

- 결정: 도구마다 `{permission, plans, mode}`를 두고(`TOOL_REQUIREMENTS`), 권한은 같은 일을 하는 일반 API와 같게, 플랜은 매뉴얼 기능표와 같게 둡니다. 급여 조회는 두 출처를 합쳐 `TAXATION | PAYROLL`
- 검토한 대안: 레거시 판정 그대로(메뉴 코드 + `tax_plan`). 플랜만 보고 권한은 보지 않음
- 선택 이유: 비서가 권한 우회로가 되지 않는 것이 우선입니다. 매뉴얼과 레거시가 다를 때는 고객에게 약속한 매뉴얼을 따릅니다
- 가정과 되돌릴 조건: 매뉴얼의 "세무 기장 고객"이 급여 조회 대상이라는 가정입니다. 급여 데이터가 급여 플랜에만 있다면 `LOOKUP_PAYROLL`을 `PAYROLL`만으로 좁힙니다

**쓰기 도구 실행 (5)**

- 결정: 비서는 쓰기 도구를 실행하지 않습니다. 서버가 모델 제안을 허용 도구로 거르고 `CONFIRM` 도구에는 `requiresConfirmation: true`를 강제합니다. 사용자가 확인하면 클라이언트가 `arguments`로 해당 컨텍스트의 일반 API를 부릅니다
- 검토한 대안: `POST /conversations/{id}/proposals/{n}:confirm`으로 비서가 대신 실행하고 `ai_tool_audit`에 기록
- 선택 이유: 실행 경로가 하나면 권한·멱등성·감사 로그·전제 조건 검사가 한 곳에 있습니다. 비서 전용 실행 경로는 같은 검사를 다시 구현해야 합니다
- 가정과 되돌릴 조건: 클라이언트가 제안 인자를 일반 API 요청으로 바꿀 수 있다는 가정입니다. 인자 변환이 복잡해지면 확인 커맨드를 두되 내부에서 같은 서비스를 부릅니다

**대화 소유 (6)**

- 결정: 대화는 만든 사용자만 봅니다. 세무 대리인은 기본으로 비서에 들어오지 못합니다(D5). 대리인 기본 권한에 `conversation:*`·`grant:read`가 없어 `POST /conversations`가 403 `PERMISSION_DENIED`입니다
- 검토한 대안: 회사 공유 대화. 대리인도 고객 회사에서 자기 대화를 가짐(D5 전의 결정)
- 선택 이유: 대화에 개인적인 질문이 섞이고, 레거시도 개인 것으로 저장했습니다. 비서는 고객용 기능이고 레거시도 대리인에게 열지 않았으므로 대리인 권한을 고객 업무와 대리인 전용 동작으로 좁힌 D5([review.md](../review.md#결정))를 따릅니다
- 가정과 되돌릴 조건: 회사 안에서 대화를 넘겨 볼 요구가 생기면 공유 커맨드를 추가합니다. 대리인에게 비서가 필요해지면 `AGENT_EXCLUDED_RESOURCES`에서 `conversation`을 빼면 됩니다

## grant-recommendation

| # | 질문 | 결정 | 내용 |
|---|---|---|---|
| 1 | 15개를 고르는 순서 | 보류 | 마감 임박순, 상시는 마지막, 같으면 ID순 (레거시 정렬). 법령·고시가 아니라 제품 정렬 기준이라 공개 원문으로 확인할 수 없습니다. 남은 것: 현행 화면의 정렬 확인 |
| 2 | 업종 없는 회사의 업종 제한 공고 | 바꿈 | 업종으로 거르지 않음 (매뉴얼) |
| 3 | 시작 전 공고 | 바꿈 | 제외 (매뉴얼) |
| 4 | 회사 업종·지역의 출처 | 바꿈 | `CompanyGrantProfiles` 포트 하나로 받음. 지역은 회사 주소, 업종은 홈택스 업종 코드 |
| 5 | 공고 원천과 코드 체계 | 보류 | 업종은 KSIC, 지역은 법정동 코드로 가정하고 앞부분 일치로 비교. 공고 원천(어느 공공 API를 쓰는지)이 정해지지 않아 그 API 문서로 확인할 수 없습니다. 남은 것: 원천 선정과 그 API의 업종·지역 코드 명세 |

### 바뀌는 케이스

| 케이스 | 현행 기대값 | 서버 기대값 |
|---|---|---|
| legacy: unclear industry matches only grants without industry limit | `["g2"]` | `["g1", "g2"]` |
| legacy: call not started yet is still recommended | `["g1"]` | `[]` |

옮기지 않은 케이스: 04:00 갱신(공고 수집 작업의 스케줄).

### 결정 기록

**노출 기간과 상한 (2, 3)**

- 결정: `applyStartOn ≤ 오늘 ≤ applyEndOn` 또는 상시 모집만, 맞춤 추천은 최대 15개, 회사 업종이 비면 업종으로 거르지 않습니다
- 검토한 대안: 레거시 동작(시작일 미확인, 상한 없음, 업종 없으면 무제한 공고만)
- 선택 이유: 매뉴얼이 명시한 동작이고 레거시는 버그로 봅니다
- 가정과 되돌릴 조건: 없음

**정렬 (1)**

- 결정: 마감 임박순, 상시 모집은 마지막, 같으면 ID순으로 15개를 자릅니다
- 검토한 대안: 업종·지역 일치 정도 점수(`company_grant_recommendations.score`), 모델 순위
- 선택 이유: 매뉴얼에 점수 기준이 없습니다. 마감 임박순은 고객이 놓치기 쉬운 공고를 먼저 보여 줍니다
- 가정과 되돌릴 조건: 제품이 점수 기준을 정하면 `recommendGrants`의 정렬만 바꿉니다

**코드 비교와 출처 (4, 5)**

- 결정: 업종·지역 코드를 앞부분 일치로 비교합니다(`C` ⊃ `C10`, `11` ⊃ `11680`). 회사 지역이 없으면 전국 공고만 맞습니다. 회사 정보는 `CompanyGrantProfiles` 포트로 받습니다
- 검토한 대안: 정확히 일치(레거시). 지역 없는 회사도 지역 제한 공고 추천
- 선택 이유: KSIC와 법정동 코드는 계층 코드라 공고가 상위 분류로 대상을 적는 경우를 놓치지 않습니다. 지역은 매뉴얼에 예외가 없으므로 레거시를 따릅니다
- 가정과 되돌릴 조건: 공고 원천이 다른 코드 체계를 쓰면 수집 작업이 KSIC·법정동으로 바꿔 저장합니다. 바꿀 수 없으면 비교 함수를 원천별로 둡니다
