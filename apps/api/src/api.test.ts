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

describe('API 정의', () => {
  it('addHttpApi는 같은 이름의 그룹을 조용히 덮어쓰므로 컨텍스트 그룹이 하나도 빠지지 않았는지 봅니다', () => {
    const names = CONTEXT_APIS.flatMap((api) => Object.keys(api.groups))

    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([])
    expect(Object.keys(Api.groups).length).toBe(names.length + 1)
  })

  it('메서드와 경로마다 엔드포인트가 하나뿐입니다', () => {
    const routes = Object.values(Api.groups).flatMap((group) =>
      Object.values(group.endpoints).map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    )

    expect(routes.filter((route, index) => routes.indexOf(route) !== index)).toEqual([])
  })
})
