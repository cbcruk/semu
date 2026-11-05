import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../../shared/problem/problem.ts'
import { Authentication } from '../authentication.ts'
import { AuditEntry } from './audit-log.ts'

/** 지금 회사의 보안 감사 로그입니다. 관리자 전용(`audit-log:read`)입니다. */
export class AuditLogsApi extends HttpApiGroup.make('auditLogs')
  .add(
    HttpApiEndpoint.get('list', '/audit-logs', {
      query: Schema.Struct(PageQueryFields),
      success: Page(AuditEntry),
      error: [PermissionDenied, EntitlementRequired, TermsReagreementRequired],
    }),
  )
  .middleware(Authentication) {}
