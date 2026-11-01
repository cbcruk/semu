/** Tools the AI assistant may propose, gated by plan and menu access. */
export type AssistantTool = 'finance_summary' | 'knowledge_qa' | 'issue_tax_invoice' | 'request_certificate' | 'lookup_payroll'

/** A tool call the assistant proposes; write tools wait for the user's confirmation. */
export interface ProposedToolCall {
  tool: AssistantTool
  arguments: Record<string, unknown>
  requiresConfirmation: boolean
}

/** Input of {@linkcode AssistantAdapter.reply}. */
export interface AssistantTurn {
  companyName: string
  allowedTools: readonly AssistantTool[]
  history: readonly { role: 'user' | 'assistant'; content: string }[]
  message: string
}

/** The assistant's answer to one turn. */
export interface AssistantReply {
  content: string
  toolCalls: ProposedToolCall[]
}

/** LLM backend of the AI assistant (RAG and tool calling). */
export interface AssistantAdapter {
  /** Answers one user message given the conversation so far. */
  reply(turn: AssistantTurn): Promise<AssistantReply>
}
