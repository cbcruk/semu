# AI 비서 접근과 기능 범위

## 요약

- **번들:** `/ai-agent` 라우트는 `requiresSystemAdmin`이라 회사의 시스템 관리자만 들어갑니다. 상단바 AI 입력창도 시스템 관리자가 아니면 숨기고, 메뉴 트리에서도 뺍니다
- **매뉴얼:** 노출 대상은 "전체(구독에 따라 이용 가능 기능이 다름)"입니다. 무료 고객은 재무 정보 확인·세무·노무 문의·세금계산서 발행, 세무 기장 고객은 여기에 증명서 발급 요청과 직원·급여 카드 조회가 더해집니다
- **레거시 서버:** `knowledge_qa`는 항상, `finance_summary`는 `integrate_transaction` 메뉴 권한이 있을 때, `issue_tax_invoice`·`request_certificate`는 세무 플랜, `lookup_payroll`은 급여 플랜일 때 허용했습니다. 쓰기 도구는 제안만 하고 실행하지 않았습니다
- 세 출처가 서로 다릅니다. 누가 쓸 수 있는지(시스템 관리자 vs 전체), 세금계산서 발행(무료 포함 vs 세무 플랜), 직원·급여 조회(세무 기장 vs 급여 플랜)

## 현행 위치

- 번들: 라우트 가드 `checkSystemAdminGuard`(B:104680-104830), 메뉴 제외 규칙(B:77553), 상단바(B:99952). 대화 API는 lazy chunk라 번들에 없음
- 매뉴얼: `alfred-manual/02-홈-Universal-Home/02-AI-비서.md`, `alfred-manual/12-알프레드-AI비서.md`
- 레거시 서버: `apps/api/legacy/src/modules/platform/assistant/assistant.service.ts`의 `allowedAssistantTools`, `sendAssistantMessage`, 메뉴 규칙 `platform.menus.ts`의 `ai_agent`

## 로직

- 번들 진입: `meta.requiresSystemAdmin && !isSystemAdmin` → `/dashboard`. `isSystemAdmin = companies.find(id).isSystemAdmin`
- 홈 추천 질문 카드는 `sessionStorage[AI_PREFILL_MESSAGE_KEY]`에 질문을 넣고 `/ai-agent`로 이동합니다
- 매뉴얼 기능표

| 기능 | 무료 | 세무 기장 |
|---|---|---|
| 재무 정보 확인 (거래·계좌 요약) | O | O |
| 세무·노무 전문지식 문의 (학습 데이터 밖은 답하지 않음) | O | O |
| 세금계산서 발행 (거래처 등록 + 홈택스 인증서 연동 필요) | O | O |
| 증명서 발급 요청 | X | O |
| 등록 직원·급여 카드 조회 | X | O |

- 레거시 서버 도구

```ts
const tools: AssistantTool[] = ['knowledge_qa']
if (decide(context, 'integrate_transaction').ok) tools.push('finance_summary')
if (context.taxPlan === 'taxation') tools.push('issue_tax_invoice', 'request_certificate')
if (context.hasPayrollPlan) tools.push('lookup_payroll')
```

- 레거시 서버는 담당 세무 대리인을 `isSystemAdmin: false`로 두어 `ai_agent` 메뉴에서 `PERMISSION_DENIED`가 됩니다

## 근거

`docs/reference/spec/platform.md:120`

> - **AI 비서**(`/ai-agent`, `requiresSystemAdmin: true`, `hideTopBarAiCommand`): 지금은 **회사의 시스템 관리자만** 진입(라우트 가드 + 메뉴 제외 규칙). 상단바 AI 입력창은 `!isSystemAdmin`이면 숨김(B:99952). 홈의 추천 질문 카드 → sessionStorage `AI_PREFILL_MESSAGE_KEY`로 prefill. 기능(구독별): 무료 = 재무 요약(거래·계좌), 세무·노무 지식 Q&A(RAG, 학습 외 답변 금지), 세금계산서 발행(거래처 + 홈택스 인증서 연동 필요); 세무 기장 = + 증명서 발급 요청, 직원·급여 카드 조회. 대화 목록(사이드바, 새 대화/지난 대화). API는 lazy chunk에만 있어 미확인.

`docs/reference/spec/platform.md:412`

> 3. `/ai-agent`는 `isSystemAdmin`만(B:77553).

`docs/reference/spec/platform.md:332`

> - AI 비서: … (세금계산서 발행·증명서 요청 같은 쓰기 도구는 실행 전 확인 단계 + 감사 로그). 도구 허용은 `decide()`와 구독(`tax`)으로 판정.

`alfred-manual/02-홈-Universal-Home/02-AI-비서.md`

> **노출 대상:** 전체 (구독에 따라 이용 가능 기능이 다름)
>
> **AI 비서는 누구나 쓸 수 있나요?** 네. 다만 구독 상태에 따라 이용 가능한 기능이 다릅니다. 증명서 발급과 직원·급여 조회는 세무 기장 고객만 이용할 수 있습니다.
>
> 거래처 등록과 홈택스 인증서 연동이 완료되어야 발행할 수 있습니다.

`alfred-manual/12-알프레드-AI비서.md`

> - **알프레드 무료고객 (기장 비 수임 고객)**
>   1. 재무정보 확인 (거래 내역 & 계좌 내역 요약)
>   1. 사업과 관련된 세무, 노무 전문지식 문의
>   1. 세금계산서 발행

## 픽스처

[`apps/api/test/fixtures/rules/assistant-tool-access.json`](../../../apps/api/test/fixtures/rules/assistant-tool-access.json): 14건 (추적 14)

| 케이스 | 입력 | 결과 |
|---|---|---|
| 번들, 시스템 관리자 | | 진입, 상단바 입력창 표시 |
| 번들, 시스템 관리자 아닌 관리자·일반 사용자 | | `/dashboard`, 입력창 숨김 |
| 매뉴얼, 무료 / 세무 기장 | | 기능 3개 / 5개 |
| 매뉴얼, 거래처·홈택스 인증서 없음 | 세금계산서 발행 | 불가 |
| 레거시, 무료 관리자 | | `knowledge_qa`, `finance_summary` |
| 레거시, 연동 메뉴 권한 없는 멤버 | | `knowledge_qa`만 |
| 레거시, 세무 + 급여 | | 5개 도구 |
| 레거시, 쓰기 도구 | | 확인 요청만, 실행 안 함 |
| 레거시, 세무 대리인 | | `PERMISSION_DENIED` |

## 서버 이전 시 주의

- 접근 대상(시스템 관리자 vs 전체)을 정해야 합니다. 매뉴얼이 최신 안내라면 시스템 관리자 게이트는 베타 시기의 흔적입니다
- 도구 허용은 서버가 판정합니다. 읽기 도구는 그 데이터를 읽는 권한(`resource:read`)을, 쓰기 도구는 해당 커맨드 권한과 플랜을 그대로 요구해서 AI 비서가 권한 우회로가 되지 않게 합니다
- 세금계산서 발행은 매뉴얼상 무료 기능이고 전제 조건(거래처, 홈택스 인증서 연동)이 있습니다. 도구 목록에 넣되 전제 조건이 없으면 안내만 돌려줍니다
- 쓰기 도구는 제안 → 사용자 확인 → 실행 순서로 두고, 실행은 일반 API와 같은 감사 로그를 남깁니다
- 대화가 사용자 본인 것인지 회사 공유인지 알 수 없습니다. 레거시 서버는 본인 것만 보여 줬습니다

