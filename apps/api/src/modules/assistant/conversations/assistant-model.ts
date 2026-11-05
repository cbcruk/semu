import { Context, Effect, Layer } from 'effect'
import type { AllowedTool } from '../tools/assistant-tool.types.ts'
import type { AssistantUnavailable, ToolProposal } from './conversation.ts'

/** 모델에 넘기는 대화 한 턴입니다. */
export interface AssistantTurn {
  /** 이 행위자에게 허용된 도구입니다. 모델은 이 안에서만 제안합니다. */
  tools: ReadonlyArray<AllowedTool>
  history: ReadonlyArray<{ role: 'USER' | 'ASSISTANT'; content: string }>
  message: string
}

/** 모델의 답입니다. */
export interface AssistantReply {
  content: string
  toolProposals: ReadonlyArray<ToolProposal>
}

/**
 * AI 비서의 언어 모델(RAG + 도구 호출) 포트입니다. 현행 레거시 `AssistantAdapter`입니다.
 *
 * 모델이 허용되지 않은 도구를 제안해도 서비스가 걸러 내므로, 구현은 권한을 몰라도 됩니다.
 */
export class AssistantModel extends Context.Service<
  AssistantModel,
  {
    reply(turn: AssistantTurn): Effect.Effect<AssistantReply, AssistantUnavailable>
  }
>()('semu/assistant/AssistantModel') {
  /**
   * 결정적인 가짜 모델입니다. 메시지의 낱말로 도구를 고르고, 허용되지 않은 도구는 안내 문장으로 답합니다.
   *
   * - `세금계산서` → `ISSUE_TAX_INVOICE` 제안(확인 필요)
   * - `증명서` → `REQUEST_CERTIFICATE` 제안(확인 필요)
   * - `급여`, `직원` → `LOOKUP_PAYROLL`
   * - `거래`, `계좌` → `FINANCE_SUMMARY`
   * - 그 밖 → `KNOWLEDGE_QA`
   */
  static readonly layerFake = Layer.succeed(
    AssistantModel,
    AssistantModel.of({
      reply: (turn) => Effect.succeed(fakeReply(turn)),
    }),
  )
}

const KEYWORDS: ReadonlyArray<readonly [AllowedTool['tool'], ReadonlyArray<string>]> = [
  ['ISSUE_TAX_INVOICE', ['세금계산서']],
  ['REQUEST_CERTIFICATE', ['증명서']],
  ['LOOKUP_PAYROLL', ['급여', '직원']],
  ['FINANCE_SUMMARY', ['거래', '계좌']],
]

function fakeReply(turn: AssistantTurn): AssistantReply {
  const wanted = KEYWORDS.find(([, words]) => words.some((word) => turn.message.includes(word)))?.[0] ?? 'KNOWLEDGE_QA'
  const allowed = turn.tools.find((tool) => tool.tool === wanted)
  if (allowed === undefined) {
    return { content: `${wanted} 기능은 지금 구독이나 권한으로는 쓸 수 없습니다.`, toolProposals: [] }
  }
  if (allowed.mode === 'CONFIRM') {
    return {
      content: '아래 내용으로 진행할까요? 확인하면 실행합니다.',
      toolProposals: [{ tool: wanted, arguments: { request: turn.message }, requiresConfirmation: true }],
    }
  }
  if (wanted === 'KNOWLEDGE_QA') {
    return { content: `"${turn.message}"에 대한 세무·노무 안내입니다.`, toolProposals: [] }
  }
  return {
    content: `${wanted} 결과를 요약했습니다.`,
    toolProposals: [{ tool: wanted, arguments: {}, requiresConfirmation: false }],
  }
}
