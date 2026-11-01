import type { ServiceDeps } from '../../../app.types'
import { execute, queryAll, queryOne, transaction } from '../../../db/query'
import { notFound } from '../../../lib/domain-error'
import { decide } from '../../access/access'
import type { AccessContext } from '../../access/access.types'
import type { AssistantTool } from '../adapters/assistant.adapter'
import { findCompanyProfile } from '../company-profile/company-profile.repository'
import type { PlatformDeps } from '../platform.types'
import { newId, parseStringArray } from '../platform.utils'

interface ConversationRow {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls: string | null
  created_at: string
}

interface GrantRow {
  id: string
  source: string
  title: string
  agency: string
  region_codes: string
  industry_codes: string
  apply_start_on: string
  apply_end_on: string | null
  url: string
  summary: string
}

/**
 * Lists the tools the assistant may propose to this user.
 *
 * Read tools follow the menus the user can open; invoice issuing and
 * certificate requests need the tax plan, payroll lookups the payroll plan.
 */
export function allowedAssistantTools(context: AccessContext): AssistantTool[] {
  const tools: AssistantTool[] = ['knowledge_qa']
  if (decide(context, 'integrate_transaction').ok) tools.push('finance_summary')
  if (context.taxPlan === 'taxation') tools.push('issue_tax_invoice', 'request_certificate')
  if (context.hasPayrollPlan) tools.push('lookup_payroll')
  return tools
}

/** Lists the user's conversations in the company, newest first. */
export function listConversations(deps: ServiceDeps, companyId: string, userId: string): Record<string, unknown>[] {
  return queryAll<ConversationRow>(
    deps.db,
    'SELECT id, title, created_at, updated_at FROM ai_conversations WHERE company_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC',
    [companyId, userId],
  ).map((row) => ({ ...row }))
}

/**
 * Returns a conversation with its messages.
 *
 * @throws {DomainError} `NOT_FOUND` for other users' or deleted conversations.
 */
export function getConversation(deps: ServiceDeps, companyId: string, userId: string, conversationId: string): Record<string, unknown> {
  const conversation = requireConversation(deps, companyId, userId, conversationId)
  const messages = listMessages(deps, companyId, conversationId).map((row) => ({
    ...row,
    tool_calls: row.tool_calls === null ? [] : (JSON.parse(row.tool_calls) as unknown),
  }))
  return { ...conversation, messages }
}

/**
 * Sends a user message and stores the assistant's reply.
 *
 * Starts a new conversation when `conversationId` is `null`. Proposed write
 * tools are returned with `requires_confirmation` and are never executed here.
 */
export async function sendAssistantMessage(
  deps: PlatformDeps,
  context: AccessContext,
  companyId: string,
  conversationId: string | null,
  message: string,
): Promise<Record<string, unknown>> {
  const existing = conversationId === null ? null : requireConversation(deps, companyId, context.userId, conversationId)
  const history = existing === null ? [] : listMessages(deps, companyId, existing.id)
  const reply = await deps.assistant.reply({
    companyName: findCompanyProfile(deps.db, companyId)?.name ?? '',
    allowedTools: allowedAssistantTools(context),
    history: history
      .filter((row): row is MessageRow & { role: 'user' | 'assistant' } => row.role !== 'tool')
      .map((row) => ({ role: row.role, content: row.content })),
    message,
  })
  const now = deps.clock.now()
  const id = existing?.id ?? newId('conv')
  const toolCalls = reply.toolCalls.map((call) => ({ tool: call.tool, arguments: call.arguments, requires_confirmation: call.requiresConfirmation }))
  transaction(deps.db, () => {
    if (existing === null) {
      execute(deps.db, 'INSERT INTO ai_conversations (id, company_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
        id,
        companyId,
        context.userId,
        message.slice(0, 40),
        now,
        now,
      ])
    } else {
      execute(deps.db, 'UPDATE ai_conversations SET updated_at = ? WHERE company_id = ? AND id = ?', [now, companyId, id])
    }
    execute(deps.db, "INSERT INTO ai_messages (company_id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)", [companyId, id, message, now])
    execute(deps.db, "INSERT INTO ai_messages (company_id, conversation_id, role, content, tool_calls, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)", [
      companyId,
      id,
      reply.content,
      toolCalls.length === 0 ? null : JSON.stringify(toolCalls),
      now,
    ])
  })
  return { conversation_id: id, reply: { role: 'assistant', content: reply.content, tool_calls: toolCalls } }
}

/** Soft-deletes a conversation of the user. */
export function deleteConversation(deps: ServiceDeps, companyId: string, userId: string, conversationId: string): void {
  requireConversation(deps, companyId, userId, conversationId)
  execute(deps.db, 'UPDATE ai_conversations SET deleted_at = ? WHERE company_id = ? AND id = ?', [deps.clock.now(), companyId, conversationId])
}

/**
 * Recommends open grants matching the company's region and industries.
 *
 * Grants with no region or industry restriction match every company; closed
 * calls are left out.
 */
export function recommendGrants(deps: ServiceDeps, companyId: string): Record<string, unknown>[] {
  const company = findCompanyProfile(deps.db, companyId)
  const today = deps.clock.today()
  const region = company?.region_code ?? null
  const industries = new Set(parseBusinessTypeCodes(company?.business_types ?? null))
  return queryAll<GrantRow>(
    deps.db,
    'SELECT id, source, title, agency, region_codes, industry_codes, apply_start_on, apply_end_on, url, summary FROM grants WHERE apply_end_on IS NULL OR apply_end_on >= ? ORDER BY apply_end_on IS NULL, apply_end_on, id',
    [today],
  )
    .filter((row) => {
      const regions = parseStringArray(row.region_codes)
      const codes = parseStringArray(row.industry_codes)
      const regionOk = regions.length === 0 || (region !== null && regions.includes(region))
      const industryOk = codes.length === 0 || codes.some((code) => industries.has(code))
      return regionOk && industryOk
    })
    .map((row) => ({
      id: row.id,
      source: row.source,
      title: row.title,
      agency: row.agency,
      apply_start_on: row.apply_start_on,
      apply_end_on: row.apply_end_on,
      url: row.url,
      summary: row.summary,
    }))
}

function parseBusinessTypeCodes(json: string | null): string[] {
  if (json === null) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item: unknown) => {
      if (typeof item === 'string') return [item]
      if (typeof item === 'object' && item !== null && 'code' in item && typeof item.code === 'string') return [item.code]
      return []
    })
  } catch {
    return []
  }
}

function requireConversation(deps: ServiceDeps, companyId: string, userId: string, conversationId: string): ConversationRow {
  const row = queryOne<ConversationRow>(
    deps.db,
    'SELECT id, title, created_at, updated_at FROM ai_conversations WHERE company_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL',
    [companyId, userId, conversationId],
  )
  if (row === undefined) throw notFound('Conversation')
  return row
}

function listMessages(deps: ServiceDeps, companyId: string, conversationId: string): MessageRow[] {
  return queryAll<MessageRow>(
    deps.db,
    'SELECT id, role, content, tool_calls, created_at FROM ai_messages WHERE company_id = ? AND conversation_id = ? ORDER BY id',
    [companyId, conversationId],
  )
}
