import { drfPage, pageOf } from '../hr/hr.mapping.ts'
import { etagHeader, upstream, versionTag } from '../hr/employee-scope.ts'
import { readObject } from '../legacy-body.ts'
import { LegacyError, legacyErrors } from '../legacy-error.ts'
import { allLedgers, withRows } from '../payroll/ledgers.routes.ts'
import { isYearMonth } from '../payroll/ledgers.mapping.ts'
import { json } from '../router.ts'
import type { Route, SignedInContext } from '../router.ts'
import { readJson } from '../upstream.ts'
import type { SessionGuard } from '../upstream.ts'
import type { Filing, FilingHistoryEntry, FilingSummary, Page } from '../upstream.types.ts'
import {
  filingCovering,
  legacyFilingOrder,
  requirementCodeOf,
  toLegacyFiling,
  toLegacyFilingDetail,
  toLegacyFilingError,
  toLegacyWithholdingSummary,
} from './withholding.mapping.ts'

const BASE = '/api/company/:companyId/tax/withholding-tax'
const FILING = `${BASE}/:filingId`

/** 새 신고 건 ID입니다. 현행 UUID나 다른 종류의 ID는 현행처럼 404입니다. */
const FILING_ID = /^fil_[0-9A-HJKMNP-TV-Z]{26}$/

/** 새 API가 한 번에 주는 최대 신고 건 수입니다. */
const UPSTREAM_PAGE_SIZE = 200

/** 현행 메모의 최대 길이입니다(현행 zod `max(1000)`). */
const NOTE_MAX = 1000

const DATE = /^\d{4}-\d{2}-\d{2}$/
const VERSION_TAG = /^(?:W\/)?"?(\d+)"?$/

/** 성공 본문을 읽고, 실패면 현행 오류로 바꿔 던집니다. 신고 건이 없으면 현행 404 "Filing not found."입니다. */
async function read<A>(response: Response, status?: Filing['status']): Promise<A> {
  if (response.status === 404) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => undefined)
    const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined
    if (code === 'REQUIREMENT_NOT_FOUND') throw legacyErrors.notFound('Requirement')
    throw legacyErrors.notFound('Filing')
  }
  try {
    return await readJson<A>(response)
  } catch (error) {
    if (!(error instanceof LegacyError)) throw error
    throw toLegacyFilingError(error, status)
  }
}

/** 경로의 신고 건 ID를 새 API 경로로 씁니다. 새 신고 건 ID 형식이 아니면 새 API를 부르지 않고 404입니다. */
function filingPath(context: SignedInContext): string {
  const id = context.params['filingId'] ?? ''
  if (!FILING_ID.test(id)) throw legacyErrors.notFound('Filing')
  return `/v1/filings/${id}`
}

/**
 * 경로의 원천세 신고 건을 읽습니다. 현행 경로는 세목이 경로에 있어(`requireFilingOfType`) 다른 세목의 신고 건은 404였습니다.
 * 새 API는 세목이 필드라 BFF가 읽고 확인합니다.
 */
async function withholdingFiling(context: SignedInContext): Promise<{ filing: Filing; etag: string }> {
  const response = await upstream(context, 'GET', filingPath(context))
  const filing = await read<Filing>(response)
  if (filing.taxType !== 'WITHHOLDING_TAX') throw legacyErrors.notFound('Filing')
  return { filing, etag: response.headers.get('etag') ?? versionTag(filing.version) }
}

/**
 * 현행 상태 전이의 `If-Match`(신고 건 버전)입니다. 현행 서버처럼 없으면 428, 형식이 틀리면 412이고 둘 다 새 API를 부르기 전입니다.
 *
 * @returns 받은 헤더 값 그대로. 새 API에 넘깁니다.
 */
function filingIfMatch(request: Request): string {
  const header = request.headers.get('if-match')
  if (header === null) {
    throw new LegacyError(428, { detail: 'Send If-Match with the filing version.', code: 'PRECONDITION_REQUIRED' })
  }
  const trimmed = header.trim()
  if (!VERSION_TAG.test(trimmed)) {
    throw new LegacyError(412, {
      detail: 'If-Match must carry a filing version such as "3".',
      code: 'VERSION_CONFLICT',
    })
  }
  return trimmed
}

/** 현행 목록의 `year`입니다. 현행처럼 2000–2100의 정수입니다. */
function yearQuery(params: URLSearchParams): number | undefined {
  const raw = params.get('year')
  if (raw === null) return undefined
  const year = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(year) || year < 2000 || year > 2100) {
    throw legacyErrors.invalidField('year', 'Invalid value.')
  }
  return year
}

/**
 * 원천세 신고 건 전체를 읽습니다. 현행 목록은 연도로 거르고 건수를 세므로 끝까지 읽습니다(회사 하나에 한 해 12건 남짓).
 * 끝없이 돌지 않게 `maxUpstreamPages`쪽에서 멈추고, 같은 커서가 다시 오면 바로 멈춥니다. 둘 다 502입니다.
 */
async function allWithholdingFilings(context: SignedInContext, guard?: SessionGuard): Promise<FilingSummary[]> {
  const { deps } = context
  const filings: FilingSummary[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let pages = 0; ; pages += 1) {
    if (pages >= deps.maxUpstreamPages) {
      throw new LegacyError(502, {
        detail: `The filing list has more than ${deps.maxUpstreamPages * UPSTREAM_PAGE_SIZE} filings; use the new API.`,
        code: 'UPSTREAM_LIST_TOO_LARGE',
      })
    }
    const query = new URLSearchParams({ taxType: 'WITHHOLDING_TAX', limit: String(UPSTREAM_PAGE_SIZE) })
    if (cursor !== undefined) query.set('cursor', cursor)
    const page = await read<Page<FilingSummary>>(
      await upstream(context, 'GET', `/v1/filings?${query}`, guard === undefined ? {} : { guard }),
    )
    filings.push(...page.items)
    cursor = page.nextCursor
    if (cursor === undefined) return filings
    if (seen.has(cursor)) {
      throw new LegacyError(502, {
        detail: 'The upstream API returned a cursor it had already returned.',
        code: 'UPSTREAM_CURSOR_REPEATED',
      })
    }
    seen.add(cursor)
  }
}

/**
 * 현행 상태 전이(제출·제출 취소·납부)입니다. 순서는 현행과 같게 `If-Match` → 본문 → 신고 건(세목) → 새 커맨드입니다.
 * 새 API가 버전·행위자·상태를 봅니다.
 */
async function transition(
  context: SignedInContext,
  command: 'submit' | 'unsubmit' | 'pay',
  body?: (raw: Record<string, unknown>) => Record<string, unknown>,
): Promise<Response> {
  const ifMatch = filingIfMatch(context.request)
  const payload = body === undefined ? undefined : body(await readObject(context.request))
  const { filing } = await withholdingFiling(context)
  const response = await upstream(context, 'POST', `${filingPath(context)}:${command}`, {
    headers: { 'if-match': ifMatch },
    ...(payload === undefined ? {} : { body: payload }),
  })
  const next = await read<Filing>(response, filing.status)
  return json(toLegacyFiling(next), 200, etagHeader(response.headers.get('etag') ?? versionTag(next.version)))
}

/** 현행 `pay` 본문 `{paid_on}`입니다. 실제 날짜인지는 새 API가 봅니다(422 `paid_on`). */
function payBody(raw: Record<string, unknown>): Record<string, unknown> {
  const paidOn = raw['paid_on']
  if (paidOn === undefined || paidOn === null) throw legacyErrors.invalidField('paid_on', 'This field is required.')
  if (typeof paidOn !== 'string' || !DATE.test(paidOn)) {
    throw legacyErrors.invalidField('paid_on', 'Expected a YYYY-MM-DD date.')
  }
  return { paidOn }
}

/** 현행 제출 자료 응답 본문 `{response, note?}`입니다. 현행 zod처럼 모르는 필드는 무시합니다. */
function requirementBody(raw: Record<string, unknown>): {
  response: 'PENDING' | 'NOT_APPLICABLE'
  note?: string | null
} {
  const response = raw['response']
  if (response === undefined || response === null)
    throw legacyErrors.invalidField('response', 'This field is required.')
  if (response !== 'pending' && response !== 'not_applicable')
    throw legacyErrors.invalidField('response', 'Invalid value.')
  const note = raw['note']
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > NOTE_MAX)) {
    throw legacyErrors.invalidField('note', `Ensure this field is a string of at most ${NOTE_MAX} characters.`)
  }
  return {
    response: response === 'pending' ? 'PENDING' : 'NOT_APPLICABLE',
    ...(note === undefined ? {} : { note: note as string | null }),
  }
}

/**
 * 현행 원천세 요약은 세무 대리인만 읽었습니다(현행 `withholding-summary`의 `actor !== 'agency'` → 403). 새 API에는 이 요약이
 * 없어 BFF가 대장·신고 건을 읽어 만드므로, 그 회사에서 대리인으로 행동하지 않는 세션은 BFF가 막습니다.
 *
 * 급여대장 확정·해제와 같이 `callApi`의 `guard`로 보내는 호출마다 그 토큰의 grant로 봅니다. 첫 호출(신고 건 목록) 전에 보므로
 * 현행처럼 행위자가 지급월 형식보다 먼저입니다.
 */
const agencyOnly: SessionGuard = (session) =>
  session.actorKind === 'AGENCY'
    ? undefined
    : new LegacyError(403, { detail: 'Only agency staff can read the withholding summary.', code: 'PERMISSION_DENIED' })

/**
 * 현행 원천세 화면(세무 > 원천세)의 신고 건 목록·상세·제출 자료 응답·제출·제출 취소·납부와, 급여의 원천세 요약입니다.
 *
 * | 현행 (`/api/company/:companyId` 아래) | 새 API |
 * |---|---|
 * | `GET tax/withholding-tax/?year=` | `GET /v1/filings?taxType=WITHHOLDING_TAX`(끝까지), BFF가 연도로 거르고 자름 |
 * | `GET tax/withholding-tax/:filingId/` | `GET /v1/filings/{id}` + `…/history` |
 * | `PUT tax/withholding-tax/:filingId/requirements/:code/` | `GET /v1/filings/{id}` + `PATCH …/requirements/{CODE}` |
 * | `POST tax/withholding-tax/:filingId/submit/`, `unsubmit/` | `GET /v1/filings/{id}` + `:submit`, `:unsubmit` |
 * | `POST tax/withholding-tax/:filingId/pay/` | `GET /v1/filings/{id}` + `:pay {paidOn}` |
 * | `GET payroll/withholding-summary/:paymentMonth` | `GET /v1/filings?taxType=WITHHOLDING_TAX` + `GET /v1/payroll-ledgers?paymentMonth=` + 마감 대장의 `…/rows` |
 */
export const withholdingRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: BASE,
    auth: true,
    handle: async (context) => {
      const params = context.url.searchParams
      const year = yearQuery(params)
      const page = pageOf(params)
      const filings = legacyFilingOrder(await allWithholdingFilings(context)).filter(
        (filing) => year === undefined || Number(filing.periodStart.slice(0, 4)) === year,
      )
      return json(drfPage(filings.map(toLegacyFiling), page, context.url, context.deps.publicBaseUrl))
    },
  },
  {
    method: 'GET',
    path: FILING,
    auth: true,
    handle: async (context) => {
      const path = filingPath(context)
      const [{ filing, etag }, history] = await Promise.all([
        withholdingFiling(context),
        upstream(context, 'GET', `${path}/history`).then((response) => read<{ items: FilingHistoryEntry[] }>(response)),
      ])
      return json(toLegacyFilingDetail(filing, history.items), 200, etagHeader(etag))
    },
  },
  {
    method: 'PUT',
    path: `${FILING}/requirements/:code`,
    auth: true,
    handle: async (context) => {
      const body = requirementBody(await readObject(context.request))
      const { filing } = await withholdingFiling(context)
      const code = requirementCodeOf(context.params['code'] ?? '')
      if (code === undefined) throw legacyErrors.notFound('Requirement')
      const response = await upstream(context, 'PATCH', `${filingPath(context)}/requirements/${code}`, { body })
      const next = await read<Filing>(response, filing.status)
      return json(toLegacyFiling(next), 200, etagHeader(response.headers.get('etag') ?? versionTag(next.version)))
    },
  },
  { method: 'POST', path: `${FILING}/submit`, auth: true, handle: (context) => transition(context, 'submit') },
  { method: 'POST', path: `${FILING}/unsubmit`, auth: true, handle: (context) => transition(context, 'unsubmit') },
  { method: 'POST', path: `${FILING}/pay`, auth: true, handle: (context) => transition(context, 'pay', payBody) },
  {
    method: 'GET',
    path: '/api/company/:companyId/payroll/withholding-summary/:paymentMonth',
    auth: true,
    handle: async (context) => {
      const filings = await allWithholdingFilings(context, agencyOnly)
      const month = context.params['paymentMonth'] ?? ''
      if (!isYearMonth(month)) throw legacyErrors.notFound('Payment month')
      const ledgers = await allLedgers(context, { paymentMonth: month }, agencyOnly)
      const closed = await withRows(
        context,
        ledgers.filter((ledger) => ledger.status === 'CLOSED'),
        agencyOnly,
      )
      return json(toLegacyWithholdingSummary(month, ledgers, closed, filingCovering(filings, month)))
    },
  },
]
