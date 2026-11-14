import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { Scheduler } from '../../../shared/scheduler/scheduler.ts'
import { HrDirectory } from '../../hr/hr.public.ts'
import { DocumentsMemoryLive, EsignRequestsLive } from '../documents.layer.ts'
import { DocumentEvents, type DocumentEvent } from '../shared/documents-ports.ts'
import { esignExpiryTask } from './esign-expiry-task.ts'
import { EsignRequestRepository, type EsignRequestRecord } from './esign-request.ts'
import { decideExpire } from './esign-requests.ts'

const COMPANY_A = 'cmp_01JBQ00000000000000000000A' as Id<'company'>
const COMPANY_B = 'cmp_01JBQ00000000000000000000B' as Id<'company'>
let sequence = 0

function request(overrides: Partial<EsignRequestRecord>): EsignRequestRecord {
  sequence += 1
  return {
    id: `esr_01JBQ0000000000000000000${String(sequence).padStart(2, '0')}` as Id<'esignRequest'>,
    companyId: COMPANY_A,
    title: '2026 근로계약',
    status: 'PENDING',
    recipient: { name: '홍길동', email: 'hong@example.com', isForeigner: false },
    templateIds: [],
    fieldValues: {},
    hiddenFields: {},
    dueDate: '2026-11-30',
    sentAt: '2026-11-14T00:00:00.000Z',
    linkTokenHash: 'hash',
    verifyFailures: 0,
    sessions: [{ tokenHash: 'session', expiresAt: '2026-11-30T00:00:00.000Z' }],
    version: 2,
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
    ...overrides,
  }
}

describe('decideExpire', () => {
  it('기한 다음날부터 서명 대기·진행 중 요청을 만료하고 링크를 닫습니다', () => {
    const pending = request({})
    const at = '2026-11-30T15:05:00.000Z'

    expect(decideExpire(pending, '2026-11-30', at)).toBeNull()
    expect(decideExpire(pending, '2026-12-01', at)).toEqual({
      request: {
        ...pending,
        status: 'EXPIRED',
        linkTokenHash: undefined,
        sessions: [],
        version: 3,
        updatedAt: at,
      },
      events: [{ type: 'esign_request.expired', companyId: COMPANY_A, requestId: pending.id, at }],
    })
    expect(decideExpire(request({ status: 'IN_PROGRESS' }), '2026-12-01', at)?.request.status).toBe('EXPIRED')
  })

  it('완료·취소된 요청과 기한이 없는 요청은 그대로 둡니다', () => {
    expect(decideExpire(request({ status: 'COMPLETED' }), '2026-12-01', 'at')).toBeNull()
    expect(decideExpire(request({ status: 'CANCELED' }), '2026-12-01', 'at')).toBeNull()
    expect(decideExpire(request({ dueDate: undefined }), '2026-12-01', 'at')).toBeNull()
  })
})

describe('정기 작업 documents.esign-expiry', () => {
  it('매일 00:05에 회사마다 기한이 지난 요청을 만료하고 이벤트를 냅니다', async () => {
    const overdueA = request({})
    const overdueB = request({ companyId: COMPANY_B, status: 'IN_PROGRESS', dueDate: '2026-11-29' })
    const notYet = request({ dueDate: '2026-12-01' })
    const completed = request({ status: 'COMPLETED' })
    const events: DocumentEvent[] = []
    const layer = Scheduler.layer([esignExpiryTask]).pipe(
      Layer.provideMerge(EsignRequestsLive),
      Layer.provideMerge(
        Layer.mergeAll(
          DocumentsMemoryLive,
          EsignRequestRepository.layerMemory([overdueA, overdueB, notYet, completed]),
          Layer.succeed(
            DocumentEvents,
            DocumentEvents.of({ publish: (event) => Effect.sync(() => events.push(event)) }),
          ),
          // 만료는 인사 정보를 읽지 않습니다.
          Layer.succeed(HrDirectory, HrDirectory.of({} as HrDirectory['Service'])),
        ),
      ),
      Layer.provideMerge(Layer.merge(TableFactory.layerMemory, UnitOfWork.layerNone)),
    )

    const [runs, statuses] = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse('2026-12-01T00:05:00+09:00'))
        const scheduler = yield* Scheduler
        yield* scheduler.runDue()
        const repository = yield* EsignRequestRepository
        const all = [...(yield* repository.list(COMPANY_A)), ...(yield* repository.list(COMPANY_B))]
        return [yield* scheduler.runs(), Object.fromEntries(all.map((record) => [record.id, record.status]))] as const
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    )

    expect(statuses).toEqual({
      [overdueA.id]: 'EXPIRED',
      [overdueB.id]: 'EXPIRED',
      [notYet.id]: 'PENDING',
      [completed.id]: 'COMPLETED',
    })
    expect(events.map((event) => [event.type, event.companyId])).toEqual([
      ['esign_request.expired', COMPANY_A],
      ['esign_request.expired', COMPANY_B],
    ])
    expect(runs[0]).toMatchObject({ status: 'SUCCEEDED', result: { companies: 2, expired: 2 } })
  })
})
