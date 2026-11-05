import type { Permission, Plan } from '../../identity-access/actor.types.ts'

/**
 * AI 비서가 쓸 수 있는 도구입니다. 현행 `knowledge_qa`, `finance_summary`, `issue_tax_invoice`, `request_certificate`, `lookup_payroll`입니다.
 *
 * - `KNOWLEDGE_QA`: 세무·노무 지식 문의
 * - `FINANCE_SUMMARY`: 거래·계좌 요약
 * - `ISSUE_TAX_INVOICE`: 세금계산서 발행 제안
 * - `REQUEST_CERTIFICATE`: 증명서 발급 요청 제안
 * - `LOOKUP_PAYROLL`: 직원·급여 카드 조회
 */
export type AssistantTool =
  'KNOWLEDGE_QA' | 'FINANCE_SUMMARY' | 'ISSUE_TAX_INVOICE' | 'REQUEST_CERTIFICATE' | 'LOOKUP_PAYROLL'

/**
 * 도구가 어떻게 동작하는지입니다.
 *
 * - `READ`: 비서가 바로 읽어서 답합니다
 * - `CONFIRM`: 비서는 제안만 하고, 사용자가 확인한 뒤 해당 컨텍스트의 일반 API로 실행합니다
 */
export type ToolMode = 'READ' | 'CONFIRM'

/** 도구 하나를 쓰는 데 필요한 것입니다. 같은 일을 하는 일반 API의 요건과 같습니다. */
export interface ToolRequirement {
  /** 이 권한이 있어야 합니다. 없으면 모든 행위자가 씁니다. */
  permission?: Permission
  /** 이 중 하나라도 구독하면 됩니다. 비어 있으면 플랜을 보지 않습니다. */
  plans: ReadonlyArray<Plan>
  mode: ToolMode
}

/** 도구 허용 판정의 입력입니다. `Actor`에서 필요한 부분만 받습니다. */
export interface ToolAccessInput {
  permissions: ReadonlySet<Permission>
  plans: ReadonlySet<Plan>
}

/** 이 행위자에게 허용된 도구 하나입니다. */
export interface AllowedTool {
  tool: AssistantTool
  mode: ToolMode
}
