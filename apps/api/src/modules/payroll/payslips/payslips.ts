import { Clock, Effect, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { IdempotencyKeyRequired } from '../../../shared/problem/problem.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { paymentMonthOf } from '../ledgers/ledger-rules.ts'
import { PayrollLedgerRepository } from '../ledgers/payroll-ledger-repository.ts'
import type { PayrollLedgerRecord, PayrollRowRecord } from '../ledgers/payroll-ledger.types.ts'
import { PayslipNotFound } from '../payroll-problems.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayslipMailer } from '../ports/payslip-mailer.ts'
import type { Payslip, PayslipSendJob } from './payslip.ts'
import { PayslipRepository, type PayslipRecord } from './payslip-repository.ts'

/** 명세서 유스케이스가 쓰는 저장소와 포트입니다. */
export type PayslipDeps = PayrollLedgerRepository | PayslipRepository | PayrollEmployeeDirectory | PayslipMailer

type PayslipResponse = typeof Payslip.Type
type JobResponse = typeof PayslipSendJob.Type

/**
 * 마감된 대장의 명세서 목록입니다. 행마다 명세서가 하나이고, 처음 조회할 때 ID를 붙입니다.
 * 마감이 풀린 대장의 명세서는 다시 마감될 때까지 보이지 않습니다.
 */
export const listPayslips = (query: {
  ledgerId?: Id<'payrollLedger'>
  paymentMonth?: string
}): Effect.Effect<{ items: PayslipResponse[] }, AccessDenied, CurrentActor | PayslipDeps> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payslip:read', plans: ['PAYROLL'], requiresTerms: true })
    const ledgers = (yield* (yield* PayrollLedgerRepository).list(actor.companyId)).filter(
      (ledger) =>
        ledger.status === 'CLOSED' &&
        (query.ledgerId === undefined || ledger.id === query.ledgerId) &&
        (query.paymentMonth === undefined || paymentMonthOf(ledger.paymentDate) === query.paymentMonth),
    )
    const items: PayslipResponse[] = []
    for (const ledger of ledgers) {
      const records = yield* ensureRecords(ledger)
      for (const row of ledger.rows) {
        const record = records.get(row.id)
        if (record !== undefined) items.push(payslipResponse(ledger, row, record))
      }
    }
    return { items }
  })

/** 명세서 하나입니다. */
export const getPayslip = (
  id: Id<'payslip'>,
): Effect.Effect<PayslipResponse, AccessDenied | PayslipNotFound, CurrentActor | PayslipDeps> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payslip:read', plans: ['PAYROLL'], requiresTerms: true })
    const found = yield* findClosed(actor.companyId, id)
    return payslipResponse(found.ledger, found.row, found.record)
  })

/**
 * 명세서를 메일로 보냅니다. `Idempotency-Key`가 필수이고, 같은 키로 다시 오면 처음 응답을 그대로 돌려줍니다.
 * 주소가 없는 소득자는 `NO_EMAIL`로 실패하고 나머지는 보냅니다(`PARTIALLY_SUCCEEDED`).
 */
export const sendPayslips = (
  payslipIds: ReadonlyArray<Id<'payslip'>>,
  idempotencyKey: string | undefined,
): Effect.Effect<JobResponse, AccessDenied | IdempotencyKeyRequired | PayslipNotFound, CurrentActor | PayslipDeps> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payslip:send', plans: ['PAYROLL'], requiresTerms: true })
    if (idempotencyKey === undefined || idempotencyKey === '') return yield* new IdempotencyKeyRequired({})
    const repository = yield* PayslipRepository
    const replayed = yield* repository.replay(actor.companyId, idempotencyKey)
    if (Option.isSome(replayed)) return replayed.value as JobResponse
    const targets = []
    for (const id of payslipIds) targets.push(yield* findClosed(actor.companyId, id))
    const directory = yield* PayrollEmployeeDirectory
    const mailer = yield* PayslipMailer
    const createdAt = new Date(yield* Clock.currentTimeMillis).toISOString()
    const items: JobResponse['result']['items'][number][] = []
    for (const { ledger, row, record } of targets) {
      const employee =
        row.employeeId === null
          ? Option.none()
          : yield* directory.find(actor.companyId, row.employeeId, ledger.wagePeriod.end)
      const sent = yield* mailer.send({
        payslipId: record.id,
        to: Option.isSome(employee) ? employee.value.email : null,
        subject: `${ledger.title} 명세서`,
      })
      const failureReason = sent.ok ? null : sent.reason
      yield* repository.save({
        ...record,
        deliveries: [
          ...record.deliveries,
          { status: sent.ok ? 'SENT' : 'FAILED', failureReason, attemptedAt: createdAt },
        ],
      })
      items.push({ payslipId: record.id, status: sent.ok ? 'SENT' : 'FAILED', failureReason })
    }
    const failed = items.filter((item) => item.status === 'FAILED').length
    const job: JobResponse = {
      id: newId('job'),
      status: failed === 0 ? 'SUCCEEDED' : failed === items.length ? 'FAILED' : 'PARTIALLY_SUCCEEDED',
      result: { items },
      createdAt,
      finishedAt: createdAt,
    }
    yield* repository.remember(actor.companyId, idempotencyKey, job)
    return job
  })

function ensureRecords(
  ledger: PayrollLedgerRecord,
): Effect.Effect<Map<string, PayslipRecord>, never, PayslipRepository> {
  return Effect.gen(function* () {
    const repository = yield* PayslipRepository
    const records = new Map((yield* repository.listByLedger(ledger.companyId, ledger.id)).map((r) => [r.rowId, r]))
    for (const row of ledger.rows) {
      if (records.has(row.id)) continue
      const record: PayslipRecord = {
        id: newId('payslip'),
        companyId: ledger.companyId,
        ledgerId: ledger.id,
        rowId: row.id,
        deliveries: [],
      }
      yield* repository.save(record)
      records.set(row.id, record)
    }
    return records
  })
}

function findClosed(
  companyId: Id<'company'>,
  id: Id<'payslip'>,
): Effect.Effect<
  { ledger: PayrollLedgerRecord; row: PayrollRowRecord; record: PayslipRecord },
  PayslipNotFound,
  PayslipRepository | PayrollLedgerRepository
> {
  return Effect.gen(function* () {
    const record = yield* (yield* PayslipRepository).find(companyId, id)
    if (Option.isNone(record)) return yield* new PayslipNotFound({})
    const ledger = yield* (yield* PayrollLedgerRepository).find(companyId, record.value.ledgerId)
    const row = Option.isSome(ledger) ? ledger.value.rows.find((r) => r.id === record.value.rowId) : undefined
    if (Option.isNone(ledger) || ledger.value.status !== 'CLOSED' || row === undefined) {
      return yield* new PayslipNotFound({})
    }
    return { ledger: ledger.value, row, record: record.value }
  })
}

function payslipResponse(ledger: PayrollLedgerRecord, row: PayrollRowRecord, record: PayslipRecord): PayslipResponse {
  const last = record.deliveries.at(-1)
  return {
    id: record.id,
    ledgerId: ledger.id,
    rowId: row.id,
    employeeId: row.employeeId,
    payeeName: row.payeeName,
    incomeType: row.input.incomeType,
    attributionMonth: ledger.attributionMonth,
    paymentDate: ledger.paymentDate,
    payments: (row.result?.payments ?? []).map(({ code, name, amount }) => ({ code, name, amount })),
    deductions: (row.result?.deductions ?? []).map(({ code, name, amount }) => ({ code, name, amount })),
    grossPay: row.result?.grossPay ?? 0,
    deductionTotal: row.result?.deductionTotal ?? 0,
    netPay: row.result?.netPay ?? 0,
    delivery: {
      status: last?.status ?? 'NOT_SENT',
      failureReason: last?.failureReason ?? null,
      attemptedAt: last?.attemptedAt ?? null,
      attempts: record.deliveries.length,
    },
  }
}
