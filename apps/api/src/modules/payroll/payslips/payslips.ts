import { Clock, Effect, Exit, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { idempotencyExpired, requestFingerprint } from '../../../shared/http/idempotency.ts'
import { keepChanges } from '../../../shared/persistence/unit-of-work.ts'
import {
  IdempotencyKeyInProgress,
  IdempotencyKeyRequired,
  IdempotencyKeyReused,
} from '../../../shared/problem/problem.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { paymentMonthOf } from '../ledgers/ledger-rules.ts'
import { PayrollLedgerRepository } from '../ledgers/payroll-ledger-repository.ts'
import type { PayrollLedgerRecord, PayrollRowRecord } from '../ledgers/payroll-ledger.types.ts'
import { LEDGER_PLANS } from '../payroll-access.ts'
import { PayslipNotFound, PayslipSendInterrupted } from '../payroll-problems.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayslipMailer } from '../ports/payslip-mailer.ts'
import type { Payslip, PayslipSendJob } from './payslip.ts'
import { PayslipRepository, payslipSendId, type PayslipRecord, type PayslipSendRecord } from './payslip-repository.ts'

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
    const actor = yield* authorize({ permission: 'payslip:read', plans: LEDGER_PLANS, requiresTerms: true })
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
    const actor = yield* authorize({ permission: 'payslip:read', plans: LEDGER_PLANS, requiresTerms: true })
    const found = yield* findClosed(actor.companyId, id)
    return payslipResponse(found.ledger, found.row, found.record)
  })

/**
 * 명세서를 메일로 보냅니다. `Idempotency-Key`가 필수이고 키는 회사·행위자마다 따로입니다. 주소가 없는 소득자는 `NO_EMAIL`로
 * 실패하고 나머지는 보냅니다(`PARTIALLY_SUCCEEDED`).
 *
 * 같은 키로 24시간 안에 다시 오면:
 * - 본문이 다르면 422 `IDEMPOTENCY_KEY_REUSED`
 * - 앞 요청이 아직 보내는 중이면 409 `IDEMPOTENCY_KEY_IN_PROGRESS`
 * - 끝났으면 처음 작업을 그대로 돌려줍니다
 * - 메일 연동 오류로 멈췄으면(503 `PAYSLIP_SEND_INTERRUPTED`) 이미 결과가 있는 명세서는 건너뛰고 나머지를 보냅니다
 *
 * 키 확인과 예약은 저장소의 `claimSend` 한 번으로 합니다. SQLite에서는 요청 트랜잭션이 쓰기 잠금을 쥐고 있어 같은 키의 다음 요청이
 * 커밋 뒤에야 확인하므로 `IN_PROGRESS`를 볼 일이 없고 처음 작업을 돌려받습니다.
 */
export const sendPayslips = (
  payslipIds: ReadonlyArray<Id<'payslip'>>,
  idempotencyKey: string | undefined,
): Effect.Effect<
  JobResponse,
  | AccessDenied
  | IdempotencyKeyRequired
  | IdempotencyKeyReused
  | IdempotencyKeyInProgress
  | PayslipNotFound
  | PayslipSendInterrupted,
  CurrentActor | PayslipDeps
> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payslip:send', plans: LEDGER_PLANS, requiresTerms: true })
    if (idempotencyKey === undefined || idempotencyKey === '') return yield* new IdempotencyKeyRequired({})
    const repository = yield* PayslipRepository
    const id = payslipSendId(actor.companyId, actor.userId, idempotencyKey)
    const fingerprint = requestFingerprint({ payslipIds })
    const now = yield* Clock.currentTimeMillis
    const claim = yield* repository.claimSend(id, (existing): readonly [Claim, PayslipSendRecord | null] => {
      const live = Option.filter(existing, (record) => !idempotencyExpired(record.createdAt, now))
      if (Option.isNone(live)) {
        const fresh: PayslipSendRecord = {
          id,
          companyId: actor.companyId,
          actorUserId: actor.userId,
          key: idempotencyKey,
          fingerprint,
          status: 'IN_PROGRESS',
          jobId: newId('job'),
          createdAt: new Date(now).toISOString(),
          finishedAt: null,
          items: [],
        }
        return [{ _tag: 'Start', record: fresh }, fresh]
      }
      const record = live.value
      if (record.fingerprint !== fingerprint) return [{ _tag: 'Reused' }, null]
      if (record.status === 'COMPLETED') return [{ _tag: 'Replay', record }, null]
      if (record.status === 'IN_PROGRESS') return [{ _tag: 'InProgress' }, null]
      const resumed: PayslipSendRecord = { ...record, status: 'IN_PROGRESS' }
      return [{ _tag: 'Start', record: resumed }, resumed]
    })
    switch (claim._tag) {
      case 'Reused':
        return yield* new IdempotencyKeyReused({})
      case 'InProgress':
        return yield* new IdempotencyKeyInProgress({})
      case 'Replay':
        return jobResponse(claim.record)
      case 'Start':
        // 연결이 끊겨도 시작한 발송은 끝까지 갑니다. 중간에 멈추면 남은 명세서는 재시도 때까지 보내지 않습니다.
        // 요청 파이버는 이 뒤에 중단되지만, 보낸 기록은 `keepChanges`로 커밋되어 재시도가 처음 작업을 돌려받습니다.
        return yield* Effect.uninterruptible(deliver(claim.record, payslipIds))
    }
  })

type Claim =
  | { _tag: 'Start'; record: PayslipSendRecord }
  | { _tag: 'Replay'; record: PayslipSendRecord }
  | { _tag: 'Reused' }
  | { _tag: 'InProgress' }

/**
 * 예약한 발송 요청을 이어서 보냅니다. `record.items`에 결과가 있는 명세서는 건너뜁니다.
 *
 * 명세서마다 발송 기록과 요청 기록을 함께 저장합니다. 끝나면 `COMPLETED`, 실패하면 결과가 하나라도 있을 때 `INTERRUPTED`로 남기고
 * (없으면 예약을 지웁니다) 실패를 돌려줍니다. 한 건을 처리하다 난 결함(HR 조회·메일 연동·저장)은 503으로 바꿉니다.
 * 한 건이라도 보내면 `keepChanges`를 불러, 요청이 503이나 중단으로 끝나도 보낸 기록을 커밋합니다.
 */
function deliver(
  reserved: PayslipSendRecord,
  payslipIds: ReadonlyArray<Id<'payslip'>>,
): Effect.Effect<JobResponse, PayslipNotFound | PayslipSendInterrupted, CurrentActor | PayslipDeps> {
  return Effect.gen(function* () {
    const repository = yield* PayslipRepository
    let progress = reserved
    const release = Effect.suspend(() =>
      progress.items.length === 0
        ? repository.removeSend(progress.id)
        : repository.saveSend({ ...progress, status: 'INTERRUPTED' }),
    )
    return yield* Effect.gen(function* () {
      const targets = []
      for (const id of payslipIds) targets.push(yield* findClosed(progress.companyId, id))
      const directory = yield* PayrollEmployeeDirectory
      const mailer = yield* PayslipMailer
      for (const [index, { ledger, row, record }] of targets.entries()) {
        if (index < progress.items.length) continue
        // 한 건의 조회·발송·저장 전체를 감쌉니다. 앞 건을 보낸 뒤 어디서든 결함이 나면 그대로 두면 SQLite가 요청 전체를
        // 되돌려, 같은 키의 재시도가 이미 보낸 명세서를 다시 보냅니다.
        const item = yield* Effect.exit(
          Effect.gen(function* () {
            const employee =
              row.employeeId === null
                ? Option.none()
                : yield* directory.find(progress.companyId, row.employeeId, ledger.wagePeriod.end)
            const sent = yield* mailer.send({
              payslipId: record.id,
              to: Option.isSome(employee) ? employee.value.email : null,
              subject: `${ledger.title} 명세서`,
            })
            const attemptedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
            const failureReason = sent.ok ? null : sent.reason
            const status = sent.ok ? ('SENT' as const) : ('FAILED' as const)
            yield* repository.save({
              ...record,
              deliveries: [...record.deliveries, { status, failureReason, attemptedAt }],
            })
            const next: PayslipSendRecord = {
              ...progress,
              items: [...progress.items, { payslipId: record.id, status, failureReason }],
            }
            yield* repository.saveSend(next)
            return next
          }),
        )
        if (Exit.isFailure(item)) {
          yield* Effect.logWarning('Payslip sending failed midway', {
            payslipId: record.id,
            sent: progress.items.length,
          })
          return yield* new PayslipSendInterrupted({})
        }
        progress = item.value
        // 한 건이라도 보냈으면 이 요청이 실패(503)나 중단(연결 끊김)으로 끝나도 커밋합니다. 기록이 되돌려지면 같은 키의
        // 재시도가 이미 보낸 명세서를 다시 보냅니다. 결함은 위에서 503으로 바꾸므로 되돌려지지 않습니다.
        yield* keepChanges
      }
      progress = {
        ...progress,
        status: 'COMPLETED',
        finishedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      }
      yield* repository.saveSend(progress)
      return jobResponse(progress)
    }).pipe(Effect.onError(() => (progress.status === 'COMPLETED' ? Effect.void : release)))
  })
}

function jobResponse(record: PayslipSendRecord): JobResponse {
  const failed = record.items.filter((item) => item.status === 'FAILED').length
  return {
    id: record.jobId,
    status: failed === 0 ? 'SUCCEEDED' : failed === record.items.length ? 'FAILED' : 'PARTIALLY_SUCCEEDED',
    result: { items: record.items.map((item) => ({ ...item })) },
    createdAt: record.createdAt,
    finishedAt: record.finishedAt ?? record.createdAt,
  }
}

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
