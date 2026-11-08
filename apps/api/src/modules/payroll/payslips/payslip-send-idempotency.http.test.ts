import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { DAY_MS, shiftableClock } from '../../../shared/testing/shiftable-clock.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { payrollTestApp, type PayrollTestApp } from '../payroll-testing.ts'
import { rateBasedSetting, testEmployee } from '../payroll-test-fixtures.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayslipMailer } from '../ports/payslip-mailer.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { PayslipRepository } from './payslip-repository.ts'
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

/** 명세서 저장소 가짜입니다. `dieOnSave`번째 `save`(켠 뒤부터 셈)가 결함으로 죽습니다. */
function controlledRepository(control: { dieOnSave: number | null }) {
  return Layer.effect(
    PayslipRepository,
    Effect.map(
      Effect.gen(function* () {
        return yield* PayslipRepository
      }),
      (inner) =>
        PayslipRepository.of({
          ...inner,
          save: (record) => {
            if (control.dieOnSave === null) return inner.save(record)
            control.dieOnSave -= 1
            if (control.dieOnSave > 0) return inner.save(record)
            control.dieOnSave = null
            return Effect.die(new Error('payslip store went away'))
          },
        }),
    ),
  ).pipe(Layer.provide(PayslipRepository.layer()), Layer.provide(TableFactory.layerMemory))
}

interface Fixture {
  app: PayrollTestApp
  mailer: MailerControl
  repository: { dieOnSave: number | null }
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
  const repository: { dieOnSave: number | null } = { dieOnSave: null }
  const clock = { ms: 0 }
  const app = payrollTestApp(
    [
      PayrollEmployeeDirectory.layerMemory([{ companyId: TEST_COMPANY_ID, employee: testEmployee() }]),
      controlledRepository(repository),
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
  fixture = { app, mailer, repository, clock, withEmail, withoutEmail }
  return fixture
}

function send(app: PayrollTestApp, key: string, payslipIds: string[], token?: string) {
  return app.request('POST', '/payslips:send', { idempotencyKey: key, body: { payslipIds }, token })
}

describe('POST /payslips:send 멱등성', () => {
  it('첫 요청이 보내는 중에 같은 키가 오면 한 번만 보냅니다', async () => {
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

  it('같은 키에 본문이 다르면 거절하고 첫 작업을 재생하지 않습니다', async () => {
    const { app, mailer, withEmail, withoutEmail } = await setUp()

    const first = await send(app, 'k-body', [withEmail])
    const second = await send(app, 'k-body', [withoutEmail])

    expect(first.status).toBe(202)
    expect(second.status).toBe(422)
    expect(second.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(mailer.sent).toEqual([withEmail])
  })

  it('24시간 안에는 재생하고 그 뒤에는 새 키로 봅니다', async () => {
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

  it('중간에 실패한 뒤 다시 시도해도 이미 보낸 급여명세서는 다시 보내지 않습니다', async () => {
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

  it('메일 발송 외의 곳에서 실패해도 앞서 기록한 급여명세서는 다시 보내지 않습니다', async () => {
    const { app, mailer, repository, withEmail, withoutEmail } = await setUp()
    // 첫 건은 보내고 기록합니다. 둘째 건은 메일을 보낸 뒤 발송 기록 저장이 죽습니다.
    repository.dieOnSave = 2

    const failed = await send(app, 'k-store', [withoutEmail, withEmail])
    const retried = await send(app, 'k-store', [withoutEmail, withEmail])

    expect(failed.status).toBe(503)
    expect(failed.body).toMatchObject({ code: 'PAYSLIP_SEND_INTERRUPTED' })
    expect(retried.status).toBe(202)
    // 기록하지 못한 둘째 건만 다시 보냅니다. 메일 연동에 건별 멱등 키가 생기기 전의 알려진 제약입니다.
    expect(mailer.sent).toEqual([withoutEmail, withEmail, withEmail])
    const detail = await app.request('GET', `/payslips/${withoutEmail}`)
    expect(detail.body.delivery).toMatchObject({ status: 'FAILED', attempts: 1 })
  })

  it('클라이언트 연결이 끊겨도 시작한 발송을 마치고 다시 시도하면 재생합니다', async () => {
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

  it('아무것도 보내기 전에 실패한 요청은 키를 잡아 두지 않습니다', async () => {
    const { app, mailer, withEmail } = await setUp()

    const missing = await send(app, 'k-missing', ['psl_01JBQ000000000000000000099'])
    const corrected = await send(app, 'k-missing', [withEmail])

    expect(missing.status).toBe(404)
    expect(corrected.status).toBe(202)
    expect(mailer.sent).toEqual([withEmail])
  })

  it('키는 회사뿐 아니라 요청한 사용자마다 따로 봅니다', async () => {
    const { app, mailer, withEmail } = await setUp()

    const mine = await send(app, 'k-scope', [withEmail])
    const theirs = await send(app, 'k-scope', [withEmail], OTHER_TOKEN)

    expect(theirs.status).toBe(202)
    expect(theirs.body.id).not.toBe(mine.body.id)
    expect(mailer.sent).toEqual([withEmail, withEmail])
  })
})
