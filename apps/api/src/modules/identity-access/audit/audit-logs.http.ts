import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { paginate } from '../../../shared/http/pagination.ts'
import { authorize } from '../authorization.ts'
import { AuditLog } from './audit-log.ts'

/** 감사 로그 핸들러입니다. */
export const AuditLogsHttpLive = HttpApiBuilder.group(
  Api,
  'auditLogs',
  Effect.fn(function* (handlers) {
    const audit = yield* AuditLog
    return handlers.handleAll({
      list: ({ query }) =>
        authorize({ permission: 'audit-log:read' }).pipe(
          Effect.flatMap((actor) => audit.listByCompany(actor.companyId)),
          Effect.map((entries) =>
            paginate(
              [...entries].sort((a, b) => newestFirstKey(a).localeCompare(newestFirstKey(b))),
              newestFirstKey,
              query,
            ),
          ),
        ),
    })
  }),
)

function newestFirstKey(entry: { occurredAt: string; id: string }): string {
  return `${String(Number.MAX_SAFE_INTEGER - Date.parse(entry.occurredAt)).padStart(16, '0')}|${entry.id}`
}
