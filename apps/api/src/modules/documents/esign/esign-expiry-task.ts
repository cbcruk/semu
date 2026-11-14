import { Effect } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { eachCompany } from '../../../shared/scheduler/scheduler.ts'
import type { ScheduledTask } from '../../../shared/scheduler/scheduler.ts'
import { EsignRequestRepository } from './esign-request.ts'
import { EsignRequests } from './esign-requests.ts'

/**
 * 매일 00:05(회사 시간대)에 서명 기한이 지난 요청을 만료합니다. 기한은 `dueDate` 당일까지라 다음날 00:00부터 만료이고, 자정 직후 몇 분은
 * 여유로 둡니다. 서명 대기·진행 중 요청이 있는 회사마다 한 트랜잭션으로 `EsignRequests.expireOverdue`를 부릅니다.
 *
 * 작업이 늦어도 조회와 서명 링크는 기한이 지난 요청을 이미 만료로 보여 줍니다(`effectiveStatus`). 작업은 그것을 저장하고 이벤트를 냅니다.
 */
export const esignExpiryTask: ScheduledTask<EsignRequests | EsignRequestRepository | UnitOfWork> = {
  name: 'documents.esign-expiry',
  spec: { kind: 'DAILY', at: '00:05' },
  run: () =>
    Effect.gen(function* () {
      const awaiting = yield* (yield* EsignRequestRepository).listAwaitingSignature()
      const companies = [...new Set(awaiting.map((record) => record.companyId))]
      const service = yield* EsignRequests
      const { succeeded, results } = yield* eachCompany(
        companies,
        (companyId) => companyId,
        (companyId: Id<'company'>) => service.expireOverdue(companyId),
      )
      return { companies: succeeded, expired: results.reduce((sum, { result }) => sum + result, 0) }
    }),
}
