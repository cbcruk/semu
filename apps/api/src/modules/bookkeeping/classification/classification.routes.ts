import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { notFound } from '../../../lib/domain-error'
import { toPage } from '../../../lib/drf-pagination'
import { assertAllowed } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { decide } from '../../access/access'
import type { AccessContext, MenuCode } from '../../access/access.types'
import { getBankTransaction } from '../bank/bank.service'
import { getEvidence } from '../evidence/evidence.service'
import { findRuleRow } from './classification.repository'
import { ruleApplyBody, ruleCreateBody, ruleListQuery, ruleOrderBody, rulePreviewBody, ruleUpdateBody } from './classification.schema'
import { applyRules, createRule, deleteRule, getApplyJob, listRules, previewRule, reorderRules, updateRule } from './classification.service'
import type { RuleScope } from './classification.types'

const SCOPE_MENU: Record<RuleScope, MenuCode> = {
  sales: 'bookkeeping_sales_evidence',
  purchase: 'bookkeeping_purchase_evidence',
  bank: 'bookkeeping_bank_transactions',
}

/** Classification rule routes, mounted under `/api/company/:companyId`; each scope needs its screen's menu. */
export function classificationRuleRoutes(deps: AppDeps): Hono<AppEnv> {
  const scopeOfRule = (companyId: string, id: string): RuleScope => {
    const rule = findRuleRow(deps.db, companyId, id)
    if (rule === undefined) throw notFound('Rule')
    return rule.scope
  }
  return new Hono<AppEnv>()
    .get('/classification-rules', zValidator('query', ruleListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      allowScope(c.var.access, query.scope)
      return c.json(listRules(deps.db, c.var.company.id, query.scope, query.include_hidden === 'true'))
    })
    .post('/classification-rules', zValidator('json', ruleCreateBody, validationHook), (c) => {
      const body = c.req.valid('json')
      allowScope(c.var.access, body.scope)
      return c.json(createRule(deps, c.var.company.id, body), 201)
    })
    .put('/classification-rules/order', zValidator('json', ruleOrderBody, validationHook), (c) => {
      const body = c.req.valid('json')
      allowScope(c.var.access, body.scope)
      return c.json(reorderRules(deps, c.var.company.id, body.scope, body.ids))
    })
    .post('/classification-rules/preview', zValidator('json', rulePreviewBody, validationHook), (c) => {
      const body = c.req.valid('json')
      allowScope(c.var.access, body.scope)
      const page = { limit: body.limit, offset: body.offset }
      const { ids, count } = previewRule(deps.db, c.var.company.id, body.scope, body.source ?? null, body.conditions, page)
      const scope = body.scope
      const rows = ids.map((id) => (scope === 'bank' ? getBankTransaction(deps.db, c.var.company.id, id) : getEvidence(deps.db, c.var.company.id, scope, id)))
      return c.json(toPage(rows, count, page, c.req.url))
    })
    .post('/classification-rules/apply', zValidator('json', ruleApplyBody, validationHook), (c) => {
      const body = c.req.valid('json')
      allowScope(c.var.access, body.scope)
      const job = applyRules(deps, c.var.company.id, body.scope, body.mode, body.rule_id)
      return c.json({ job_id: job.id, ...job }, 202)
    })
    .get('/classification-rules/apply/:jobId', (c) => {
      const job = getApplyJob(deps.db, c.var.company.id, c.req.param('jobId'))
      allowScope(c.var.access, job.scope)
      return c.json(job)
    })
    .patch('/classification-rules/:id', zValidator('json', ruleUpdateBody, validationHook), (c) => {
      allowScope(c.var.access, scopeOfRule(c.var.company.id, c.req.param('id')))
      return c.json(updateRule(deps, c.var.company.id, c.req.param('id'), c.req.valid('json')))
    })
    .delete('/classification-rules/:id', (c) => {
      allowScope(c.var.access, scopeOfRule(c.var.company.id, c.req.param('id')))
      deleteRule(deps, c.var.company.id, c.req.param('id'))
      return c.body(null, 204)
    })
}

function allowScope(access: AccessContext, scope: RuleScope): void {
  assertAllowed(decide(access, SCOPE_MENU[scope]))
}
