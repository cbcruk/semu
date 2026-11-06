import { readObject } from '../legacy-body.ts'
import { legacyErrors } from '../legacy-error.ts'
import { etagFrom, json } from '../router.ts'
import type { Route, SignedInContext } from '../router.ts'
import type { IndefiniteConversion, PayrollContract, PayrollContractInput, WorkContract } from '../upstream.types.ts'
import {
  fromLegacyPayrollContract,
  fromLegacyWorkContract,
  payrollContractField,
  toLegacyIndefiniteConversion,
  toLegacyPayrollContract,
  toLegacyWorkContract,
  workContractField,
} from './contracts.mapping.ts'
import {
  assertVersion,
  EMPLOYEE_BASE,
  expectNoContent,
  newestFirst,
  optionalIfMatch,
  read,
  segment,
  upstream,
  wageEmployee,
} from './employee-scope.ts'
import { drfPage, pageOf } from './hr.mapping.ts'

const WORK = `${EMPLOYEE_BASE}/work-contracts`
const PAYROLL = `${EMPLOYEE_BASE}/payroll-contracts`

/**
 * 계좌번호를 유지하려고 원문을 읽을 때 남기는 열람 사유입니다. 새 API가 개인정보 접근 기록에 남깁니다.
 * 원문은 BFF 메모리에서 바로 새 API로 돌려보내고 현행 클라이언트에는 주지 않습니다.
 */
const KEEP_ACCOUNT_REASON = encodeURIComponent('현행 급여 정보 수정: 기존 계좌 유지')

function employeePath(context: SignedInContext, rest: string): string {
  return `/v1/employees/${segment(context, 'employeeId')}${rest}`
}

async function workContracts(context: SignedInContext): Promise<WorkContract[]> {
  const [{ items }] = await Promise.all([
    read<{ items: WorkContract[] }>(await upstream(context, 'GET', employeePath(context, '/work-contracts')), {
      notFound: 'Employee',
    }),
    wageEmployee(context),
  ])
  return newestFirst(items)
}

/**
 * 경로의 직원에 딸린 급여계약 하나를 읽습니다. 새 API는 급여계약 ID만으로 찾으므로 직원이 맞는지 BFF가 확인합니다.
 *
 * @returns 계약과 그 `ETag`
 */
async function payrollContract(context: SignedInContext): Promise<{ contract: PayrollContract; response: Response }> {
  const response = await upstream(context, 'GET', `/v1/payroll-contracts/${segment(context, 'contractId')}`)
  const contract = await read<PayrollContract>(response, { notFound: 'Payroll contract' })
  if (contract.employeeId !== context.params['employeeId']) throw legacyErrors.notFound('Payroll contract')
  return { contract, response }
}

/**
 * 현행 본문에 가린 계좌번호가 오면 지금 계약의 계좌번호를 그대로 둡니다(현행 서버의 동작).
 * 새 `PUT`은 전체 교체라 계좌를 빼면 지우므로, 원문을 열람해 다시 보냅니다.
 */
async function withKeptAccount(
  context: SignedInContext,
  request: ReturnType<typeof fromLegacyPayrollContract>,
  current: PayrollContract | undefined,
): Promise<PayrollContractInput> {
  const keep = request.keepAccountNumber
  if (keep === undefined) return request.input
  if (current?.account === undefined) {
    throw legacyErrors.invalidField('account_number', 'Bank transfers need a bank, account number and holder.')
  }
  const { accountNumber } = await read<{ accountNumber: string }>(
    await upstream(context, 'GET', `/v1/payroll-contracts/${encodeURIComponent(current.id)}/account-number`, {
      headers: { 'x-access-reason': KEEP_ACCOUNT_REASON },
    }),
  )
  return { ...request.input, account: { ...keep, accountNumber } }
}

/**
 * 근로 정보(근로계약)·급여 정보(급여계약)·무기계약 전환 알림입니다.
 *
 * | 현행 | 새 API |
 * |---|---|
 * | `GET …/:employeeId/work-contracts/indefinite-conversion-alert/` | `GET /v1/employees/{id}/indefinite-conversion` |
 * | `GET …/:employeeId/work-contracts/` | `GET /v1/employees/{id}/work-contracts` |
 * | `POST …/:employeeId/work-contracts/` | `POST /v1/employees/{id}/work-contracts` |
 * | `GET …/:employeeId/work-contracts/:contractId/` | `GET /v1/employees/{id}/work-contracts`에서 찾음 |
 * | `GET …/:employeeId/payroll-contracts/` | `GET /v1/employees/{id}/payroll-contracts` |
 * | `POST …/:employeeId/payroll-contracts/` | `POST /v1/employees/{id}/payroll-contracts` |
 * | `GET`·`PUT`·`DELETE …/:employeeId/payroll-contracts/:contractId/` | `GET`·`PUT`·`DELETE /v1/payroll-contracts/{id}` |
 *
 * 근로계약 수정·삭제(`PUT`·`DELETE …/work-contracts/:contractId/`)는 새 API에 없어 경로를 두지 않습니다(현행 404).
 * 모든 경로는 직원이 근로소득자인지 확인합니다.
 */
export const contractRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: `${WORK}/indefinite-conversion-alert`,
    auth: true,
    handle: async (context) => {
      const [view] = await Promise.all([
        read<IndefiniteConversion>(await upstream(context, 'GET', employeePath(context, '/indefinite-conversion')), {
          notFound: 'Employee',
        }),
        wageEmployee(context),
      ])
      return json(toLegacyIndefiniteConversion(view))
    },
  },
  {
    method: 'GET',
    path: WORK,
    auth: true,
    handle: async (context) => {
      const page = drfPage(
        await workContracts(context),
        pageOf(context.url.searchParams),
        context.url,
        context.deps.publicBaseUrl,
      )
      return json({ ...page, results: page.results.map(toLegacyWorkContract) })
    },
  },
  {
    method: 'POST',
    path: WORK,
    auth: true,
    handle: async (context) => {
      const input = fromLegacyWorkContract(await readObject(context.request))
      await wageEmployee(context)
      const created = await read<WorkContract>(
        await upstream(context, 'POST', employeePath(context, '/work-contracts'), { body: input }),
        { rename: workContractField },
      )
      return json(toLegacyWorkContract(created), 201)
    },
  },
  {
    method: 'GET',
    path: `${WORK}/:contractId`,
    auth: true,
    handle: async (context) => {
      const contract = (await workContracts(context)).find((row) => row.id === context.params['contractId'])
      if (contract === undefined) throw legacyErrors.notFound('Work contract')
      return json(toLegacyWorkContract(contract))
    },
  },
  {
    method: 'GET',
    path: PAYROLL,
    auth: true,
    handle: async (context) => {
      const [{ items }] = await Promise.all([
        read<{ items: PayrollContract[] }>(
          await upstream(context, 'GET', employeePath(context, '/payroll-contracts')),
          { notFound: 'Employee' },
        ),
        wageEmployee(context),
      ])
      const page = drfPage(
        newestFirst(items),
        pageOf(context.url.searchParams),
        context.url,
        context.deps.publicBaseUrl,
      )
      return json({ ...page, results: page.results.map(toLegacyPayrollContract) })
    },
  },
  {
    method: 'POST',
    path: PAYROLL,
    auth: true,
    handle: async (context) => {
      const request = fromLegacyPayrollContract(await readObject(context.request))
      await wageEmployee(context)
      const input = await withKeptAccount(context, request, undefined)
      const created = await read<PayrollContract>(
        await upstream(context, 'POST', employeePath(context, '/payroll-contracts'), { body: input }),
        { rename: payrollContractField },
      )
      return json(toLegacyPayrollContract(created), 201)
    },
  },
  {
    method: 'GET',
    path: `${PAYROLL}/:contractId`,
    auth: true,
    handle: async (context) => {
      const [{ contract, response }] = await Promise.all([payrollContract(context), wageEmployee(context)])
      return json(toLegacyPayrollContract(contract), 200, etagFrom(response))
    },
  },
  {
    method: 'PUT',
    path: `${PAYROLL}/:contractId`,
    auth: true,
    handle: async (context) => {
      const request = fromLegacyPayrollContract(await readObject(context.request))
      const [{ contract, response: current }] = await Promise.all([payrollContract(context), wageEmployee(context)])
      // 현행 `PUT`은 버전을 보지 않았습니다. 클라이언트가 보낸 `If-Match`는 계좌번호를 열람하기 전에 확인하고,
      // 없으면 방금 읽은 버전으로 읽은 뒤의 변경을 덮어쓰지 않습니다.
      const sent = optionalIfMatch(context.request)
      if (sent !== undefined) assertVersion(contract.version, sent, 'payroll contract')
      const ifMatch = sent ?? current.headers.get('etag') ?? undefined
      const input = await withKeptAccount(context, request, contract)
      const response = await upstream(context, 'PUT', `/v1/payroll-contracts/${encodeURIComponent(contract.id)}`, {
        body: input,
        ...(ifMatch === undefined ? {} : { headers: { 'if-match': ifMatch } }),
      })
      const updated = await read<PayrollContract>(response, { rename: payrollContractField })
      return json(toLegacyPayrollContract(updated), 200, etagFrom(response))
    },
  },
  {
    method: 'DELETE',
    path: `${PAYROLL}/:contractId`,
    auth: true,
    handle: async (context) => {
      const [{ contract }] = await Promise.all([payrollContract(context), wageEmployee(context)])
      await expectNoContent(
        await upstream(context, 'DELETE', `/v1/payroll-contracts/${encodeURIComponent(contract.id)}`),
      )
      return new Response(null, { status: 204 })
    },
  },
]
