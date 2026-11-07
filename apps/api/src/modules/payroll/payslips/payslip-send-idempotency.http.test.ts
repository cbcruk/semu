import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { DAY_MS, shiftableClock } from '../../../shared/testing/shiftable-clock.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { payrollTestApp, type PayrollTestApp } from '../payroll-testing.ts'
import { rateBasedSetting, testEmployee } from '../payroll-test-fixtures.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayslipMailer } from '../ports/payslip-mailer.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'

const OTHER_TOKEN = 'other-client-token'
const OTHER_USER_ID = 'usr_01JBQ000000000000000000002' as Id<'user'>

/**
 * 보낸 메일을 세는 가짜 메일러입니다. `delayMs`만큼 기다린 뒤 보내고, 보낸 뒤 `ackDelayMs`만큼 늦게 응답합니다.
 * `dieOnCall`번째 호출은 결함으로 죽습니다.
 */
interface MailerControl {
  sent: string[]
  delayMs: number
  ackDelayMs: number
  dieOnCall: number | null
}

function controlledMailer(control: MailerControl) {
  return Layer.succeed(
    PayslipMailer,
    PayslipMailer.of({
      send: (message) =>
        Effect.gen(function* () {
          if (control.delayMs > 0) yield* Effect.sleep(control.delayMs)
          const call = control.sent.length + 1
          if (control.dieOnCall === call) {
            control.dieOnCall = null
            return yield* Effect.die(new Error('mail server went away'))
          }
          control.sent.push(message.payslipId)
          if (control.ackDelayMs > 0) yield* Effect.sleep(control.ackDelayMs)
          return message.to === null ? { ok: false, reason: 'NO_EMAIL' } : { ok: true }
        }),
    }),
  )
}

/** HR 조회 가짜입니다. `dieOnFind`가 참이면 다음 `find` 한 번이 결함으로 죽습니다. */
function controlledDirectory(control: { dieOnFind: boolean }) {
  return Layer.effect(
    PayrollEmployeeDirectory,
    Effect.map(
      Effect.gen(function* () {
        return yield* PayrollEmployeeDirectory
      }),
      (inner) =>
        PayrollEmployeeDirectory.of({
          ...inner,
          find: (companyId, employeeId, asOf) => {
            if (!control.dieOnFind) return inner.find(companyId, employeeId, asOf)
            control.dieOnFind = false
            return Effect.die(new Error('HR lookup failed'))
          },
        }),
    ),
  ).pipe(
    Layer.provide(PayrollEmployeeDirectory.layerMemory([{ companyId: TEST_COMPANY_ID, employee: testEmployee() }])),
  )
}

interface Fixture {
  app: PayrollTestApp
  mailer: MailerControl
  directory: { dieOnFind: boolean }
  clock: { ms: number }
  /** 주소가 있는 직원의 명세서입니다. */
  withEmail: string
  /** 주소가 없는 사업소득자의 명세서입니다. */
  withoutEmail: string
}

let fixture: Fixture | null = null

afterEach(async () => {
  await fixture?.app.dispose()
  fixture = null
})

async function setUp(): Promise<Fixture> {
  const mailer: MailerControl = { sent: [], delayMs: 0, ackDelayMs: 0, dieOnCall: null }
  const directory = { dieOnFind: false }
  const clock = { ms: 0 }
  const app = payrollTestApp(
    [
      controlledDirectory(directory),
      PayrollSettingRepository.layerMemory([{ companyId: TEST_COMPANY_ID, setting: rateBasedSetting() }]),
      controlledMailer(mailer),
      shiftableClock(clock),
    ],
    [[OTHER_TOKEN, testActor({ userId: OTHER_USER_ID })]],
  )
  const created = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2026-03' } })
  const ledgerId = created.body.id
  await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
    body: { payeeName: '박프리', input: { incomeType: 'BUSINESS', payAmount: 1_000_000 } },
  })
  await app.request('POST', `/payroll-ledgers/${ledgerId}:close`)
  const list = await app.request('GET', `/payslips?ledgerId=${ledgerId}`)
  const [withEmail, withoutEmail] = list.body.items.map((item: { id: string }) => item.id)
  fixture = { app, mailer, directory, clock, withEmail, withoutEmail }
  return fixture
}

function send(app: PayrollTestApp, key: string, payslipIds: string[], token?: string) {
  return app.request('POST', '/payslips:send', { idempotencyKey: key, body: { payslipIds }, token })
}

describe('POST /payslips:send idempotency', () => {
  it('sends once when the same key arrives while the first request is still sending', async () => {
    const { app, mailer, withEmail } = await setUp()
    mailer.delayMs = 50

    const [a, b] = await Promise.all([send(app, 'k-race', [withEmail]), send(app, 'k-race', [withEmail])])

    expect(mailer.sent).toEqual([withEmail])
    const statuses = [a.status, b.status].sort()
    // 메모리 저장소는 진행 중인 키를 409로 막고, SQLite는 쓰기 잠금으로 줄을 세워 뒤 요청이 처음 응답을 돌려받습니다.
    if (statuses[1] === 409) {
      expect(statuses).toEqual([202, 409])
      const conflict = a.status === 409 ? a : b
      expect(conflict.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS' })
    } else {
      expect(statuses).toEqual([202, 202])
      expect(a.body.id).toBe(b.body.id)
    }
  })

  it('rejects the same key with a different body and does not replay the first job', async () => {
    const { app, mailer, withEmail, withoutEmail } = await setUp()

    const first = await send(app, 'k-body', [withEmail])
    const second = await send(app, 'k-body', [withoutEmail])

    expect(first.status).toBe(202)
    expect(second.status).toBe(422)
    expect(second.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(mailer.sent).toEqual([withEmail])
  })

  it('replays within 24 hours and treats the key as new after that', async () => {
    const { app, mailer, clock, withEmail } = await setUp()

    const first = await send(app, 'k-ttl', [withEmail])
    clock.ms = DAY_MS - 1000
    const replay = await send(app, 'k-ttl', [withEmail])
    clock.ms = DAY_MS + 1000
    const fresh = await send(app, 'k-ttl', [withEmail])

    expect(replay.body.id).toBe(first.body.id)
    expect(fresh.status).toBe(202)
    expect(fresh.body.id).not.toBe(first.body.id)
    expect(mailer.sent).toEqual([withEmail, withEmail])
  })

  it('does not re-send payslips already sent when a retry follows a failure midway', async () => {
    const { app, mailer, withEmail, withoutEmail } = await setUp()
    mailer.dieOnCall = 2

    const failed = await send(app, 'k-partial', [withEmail, withoutEmail])
    const retried = await send(app, 'k-partial', [withEmail, withoutEmail])

    expect(failed.status).toBe(503)
    expect(failed.body).toMatchObject({ code: 'PAYSLIP_SEND_INTERRUPTED' })
    expect(retried.status).toBe(202)
    expect(mailer.sent).toEqual([withEmail, withoutEmail])
    expect(retried.body).toMatchObject({
      status: 'PARTIALLY_SUCCEEDED',
      result: {
        items: [
          { payslipId: withEmail, status: 'SENT' },
          { payslipId: withoutEmail, status: 'FAILED', failureReason: 'NO_EMAIL' },
        ],
      },
    })
    const detail = await app.request('GET', `/payslips/${withEmail}`)
    expect(detail.body.delivery).toMatchObject({ status: 'SENT', attempts: 1 })
  })

  it('does not re-send when something other than the mailer crashes after a mail went out', async () => {
    const { app, mailer, directory, withEmail, withoutEmail } = await setUp()
    // 사업소득자(주소 없음)는 HR을 조회하지 않고, 직원은 조회합니다. 첫 건을 보낸 뒤 HR 조회가 죽습니다.
    directory.dieOnFind = true

    const failed = await send(app, 'k-hr', [withoutEmail, withEmail])
    const retried = await send(app, 'k-hr', [withoutEmail, withEmail])

    expect(failed.status).toBe(503)
    expect(failed.body).toMatchObject({ code: 'PAYSLIP_SEND_INTERRUPTED' })
    expect(retried.status).toBe(202)
    expect(mailer.sent).toEqual([withoutEmail, withEmail])
    const detail = await app.request('GET', `/payslips/${withoutEmail}`)
    expect(detail.body.delivery).toMatchObject({ status: 'FAILED', attempts: 1 })
  })

  it('finishes a started send even if the client disconnects, so a retry replays it', async () => {
    const { app, mailer, withEmail, withoutEmail } = await setUp()
    mailer.ackDelayMs = 100
    const disconnect = new AbortController()

    const disconnected = app
      .request('POST', '/payslips:send', {
        idempotencyKey: 'k-disconnect',
        body: { payslipIds: [withEmail, withoutEmail] },
        signal: disconnect.signal,
      })
      .catch((error: unknown) => error)
    await new Promise((resolve) => setTimeout(resolve, 30))
    disconnect.abort()
    await disconnected
    // 끊긴 요청이 끝날 때까지(두 건 × 100ms) 기다립니다.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const retried = await send(app, 'k-disconnect', [withEmail, withoutEmail])

    expect(mailer.sent).toEqual([withEmail, withoutEmail])
    expect(retried.status).toBe(202)
    expect(retried.body).toMatchObject({ status: 'PARTIALLY_SUCCEEDED' })
  })

  it('does not hold the key when the request fails before sending anything', async () => {
    const { app, mailer, withEmail } = await setUp()

    const missing = await send(app, 'k-missing', ['psl_01JBQ000000000000000000099'])
    const corrected = await send(app, 'k-missing', [withEmail])

    expect(missing.status).toBe(404)
    expect(corrected.status).toBe(202)
    expect(mailer.sent).toEqual([withEmail])
  })

  it('scopes keys to the actor, not only the company', async () => {
    const { app, mailer, withEmail } = await setUp()

    const mine = await send(app, 'k-scope', [withEmail])
    const theirs = await send(app, 'k-scope', [withEmail], OTHER_TOKEN)

    expect(theirs.status).toBe(202)
    expect(theirs.body.id).not.toBe(mine.body.id)
    expect(mailer.sent).toEqual([withEmail, withEmail])
  })
})
