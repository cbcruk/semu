import type { HrTestContext } from '../helpers/test-app'

export interface JsonResponse {
  status: number
  etag: string | null
  body: Record<string, unknown>
}

export type JsonCall = (token: string, method: string, path: string, json?: unknown, ifMatch?: number) => Promise<JsonResponse>

export function jsonClient(ctx: HrTestContext, base: string): JsonCall {
  return async (token, method, path, json, ifMatch) => {
    const response = await ctx.call(token, method, `${base}${path}`, { ...(json === undefined ? {} : { json }), ...(ifMatch === undefined ? {} : { ifMatch }) })
    const text = await response.text()
    return { status: response.status, etag: response.headers.get('ETag'), body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>) }
  }
}

export function resultsOf(body: Record<string, unknown>): Record<string, unknown>[] {
  return body['results'] as Record<string, unknown>[]
}

export function cardOf(body: Record<string, unknown>): Record<string, unknown> {
  return (body['card'] ?? body) as Record<string, unknown>
}

export function fileWithholding(ctx: HrTestContext, companyId: string, taxPeriodKey: string): void {
  ctx.db.prepare("UPDATE tax_filings SET status = 'filed', payable_amount = 0 WHERE company_id = ? AND tax_type = 'withholding_tax' AND tax_period_key = ?").run(companyId, taxPeriodKey)
}

export function ledgerRequirement(ctx: HrTestContext, companyId: string, taxPeriodKey: string): { response: string; auto_linked: number } | undefined {
  return ctx.db
    .prepare(
      `SELECT r.response, r.auto_linked FROM filing_requirements r JOIN tax_filings f ON f.id = r.filing_id
       WHERE f.company_id = ? AND f.tax_type = 'withholding_tax' AND f.tax_period_key = ? AND r.code = 'payroll_ledger_closed'`,
    )
    .get(companyId, taxPeriodKey) as { response: string; auto_linked: number } | undefined
}
