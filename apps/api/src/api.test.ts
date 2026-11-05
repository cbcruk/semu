import { describe, expect, it } from 'vitest'
import { Api } from './api.ts'
import { AssistantApi } from './modules/assistant/assistant.api.ts'
import { BillingApi } from './modules/billing/billing.api.ts'
import { BookkeepingApi } from './modules/bookkeeping/bookkeeping.api.ts'
import { DocumentsApi } from './modules/documents/documents.api.ts'
import { HrApi } from './modules/hr/hr.api.ts'
import { IdentityAccessApi } from './modules/identity-access/identity-access.api.ts'
import { IntegrationsApi } from './modules/integrations/integrations.api.ts'
import { PayrollApi } from './modules/payroll/payroll.api.ts'
import { TaxApi } from './modules/tax/tax.api.ts'

const CONTEXT_APIS = [
  IdentityAccessApi,
  BillingApi,
  IntegrationsApi,
  AssistantApi,
  TaxApi,
  HrApi,
  DocumentsApi,
  PayrollApi,
  BookkeepingApi,
]

describe('Api', () => {
  it('keeps every context group, since addHttpApi silently replaces a group with the same name', () => {
    const names = CONTEXT_APIS.flatMap((api) => Object.keys(api.groups))

    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([])
    expect(Object.keys(Api.groups).length).toBe(names.length + 1)
  })

  it('maps each method and path to one endpoint', () => {
    const routes = Object.values(Api.groups).flatMap((group) =>
      Object.values(group.endpoints).map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    )

    expect(routes.filter((route, index) => routes.indexOf(route) !== index)).toEqual([])
  })
})
