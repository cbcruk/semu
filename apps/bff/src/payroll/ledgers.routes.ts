import { optionalIfMatch, upstream, versionTag } from '../hr/employee-scope.ts'
import { readObject } from '../legacy-body.ts'
import { LegacyError, legacyErrors } from '../legacy-error.ts'
import { json } from '../router.ts'
import type { Route, SignedInContext } from '../router.ts'
import { readJson } from '../upstream.ts'
import type { SessionGuard } from '../upstream.ts'
import type { Page, PayrollLedger, PayrollLedgerStatus, PayrollRow } from '../upstream.types.ts'
import {
  booleanQuery,
  groupedRows,
  isYearMonth,
  legacyCardOrder,
  legacyCardStatus,
  legacySegment,
  legacyStatus,
  parentCardIdOf,
  parseLegacySegment,
  toLegacyAdditionalError,
  toLegacyRow,
  toLegacySummary,
} from './ledgers.mapping.ts'
import type { LedgerWithRows, LegacyStatus } from './ledgers.mapping.ts'

const BASE = '/api/company/:companyId/payroll'
const CARD = `${BASE}/cards/:cardId`

/** 새 급여대장 ID입니다. 현행 정수 카드 ID나 다른 종류의 ID는 현행처럼 404입니다. */
const LEDGER_ID = /^pyl_[0-9A-HJKMNP-TV-Z]{26}$/

/** 새 API가 한 번에 주는 최대 대장 수입니다. */
const UPSTREAM_PAGE_SIZE = 200

/** 대장마다 행을 읽을 때 동시에 보내는 요청 수입니다. */
const ROW_READ_CONCURRENCY = 4

/** 현행 확정 해제에는 사유가 없습니다. 새 `:reopen`은 사유가 필수라 BFF가 넣는 사유입니다. */
export const RELEASE_REASON = '현행 급여관리 확정 해제'

/** 현행 카드 이름의 최대 길이입니다(현행 zod `max(100)`). */
const NAME_MAX = 100

const DATE = /^\d{4}-\d{2}-\d{2}$/

const LEGACY_STATUSES: readonly LegacyStatus[] = ['input_available', 'calculating', 'done']

/**
 * 성공 본문을 읽고, 실패면 현행 오류로 바꿔 던집니다. 대장이 없으면 현행 404 "Payroll card not found."이고,
 * 추가 카드 거절 사유는 현행 값으로 바꿉니다.
 */
async function read<A>(response: Response): Promise<A> {
  if (response.status === 404) throw legacyErrors.notFound('Payroll card')
  try {
    return await readJson<A>(response)
  } catch (error) {
    if (!(error instanceof LegacyError)) throw error
    throw toLegacyAdditionalError(error)
  }
}

/** 경로의 카드 ID를 새 API 경로로 씁니다. 새 대장 ID 형식이 아니면 새 API를 부르지 않고 404입니다. */
function ledgerPath(context: SignedInContext): string {
  const id = context.params['cardId'] ?? ''
  if (!LEDGER_ID.test(id)) throw legacyErrors.notFound('Payroll card')
  return `/v1/payroll-ledgers/${id}`
}

interface Versioned {
  ledger: PayrollLedger
  etag: string
}

async function versioned(response: Response): Promise<Versioned> {
  const ledger = await read<PayrollLedger>(response)
  return { ledger, etag: response.headers.get('etag') ?? versionTag(ledger.version) }
}

/** 경로의 대장을 읽습니다. */
async function ledgerOf(context: SignedInContext, guard?: SessionGuard): Promise<Versioned> {
  return versioned(await upstream(context, 'GET', ledgerPath(context), guard === undefined ? {} : { guard }))
}

/** 대장의 행 전체입니다. */
async function rowsOf(context: SignedInContext, ledger: PayrollLedger): Promise<PayrollRow[]> {
  const response = await upstream(context, 'GET', `/v1/payroll-ledgers/${encodeURIComponent(ledger.id)}/rows`)
  return (await read<{ items: PayrollRow[] }>(response)).items
}

/**
 * 조건에 맞는 대장 전체를 읽습니다. 현행 카드 목록은 페이지가 없어 끝까지 읽습니다.
 * 끝없이 돌지 않게 `maxUpstreamPages`쪽에서 멈추고, 같은 커서가 다시 오면 바로 멈춥니다. 둘 다 502입니다.
 */
async function allLedgers(
  context: SignedInContext,
  filter: { attributionMonth?: string; status?: PayrollLedgerStatus } = {},
): Promise<PayrollLedger[]> {
  const { deps } = context
  const ledgers: PayrollLedger[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let pages = 0; ; pages += 1) {
    if (pages >= deps.maxUpstreamPages) {
      throw new LegacyError(502, {
        detail: `The payroll card list has more than ${deps.maxUpstreamPages * UPSTREAM_PAGE_SIZE} cards; use the new API.`,
        code: 'UPSTREAM_LIST_TOO_LARGE',
      })
    }
    const query = new URLSearchParams({ limit: String(UPSTREAM_PAGE_SIZE) })
    if (filter.attributionMonth !== undefined) query.set('attributionMonth', filter.attributionMonth)
    if (filter.status !== undefined) query.set('status', filter.status)
    if (cursor !== undefined) query.set('cursor', cursor)
    const page = await read<Page<PayrollLedger>>(await upstream(context, 'GET', `/v1/payroll-ledgers?${query}`))
    ledgers.push(...page.items)
    cursor = page.nextCursor
    if (cursor === undefined) return legacyCardOrder(ledgers)
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
 * 대장마다 행을 읽습니다. 동시에 {@link ROW_READ_CONCURRENCY}개까지 보냅니다.
 *
 * 대장 하나에 행 호출 하나라, 대장이 `maxLedgerRowReads`개를 넘으면 행을 읽기 전에 502 `UPSTREAM_LIST_TOO_LARGE`로 멈춥니다.
 * 현행 클라이언트는 연도(`year`)·귀속월(`attr_date`)로 거르면 됩니다.
 */
async function withRows(context: SignedInContext, ledgers: readonly PayrollLedger[]): Promise<LedgerWithRows[]> {
  const limit = context.deps.maxLedgerRowReads
  if (ledgers.length > limit) {
    throw new LegacyError(502, {
      detail: `The payroll card list has more than ${limit} cards to total; filter by year or use the new API.`,
      code: 'UPSTREAM_LIST_TOO_LARGE',
    })
  }
  const results: LedgerWithRows[] = new Array(ledgers.length)
  let next = 0
  const worker = async () => {
    while (next < ledgers.length) {
      const index = next
      next += 1
      const ledger = ledgers[index] as PayrollLedger
      results[index] = { ledger, rows: await rowsOf(context, ledger) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ROW_READ_CONCURRENCY, ledgers.length) }, worker))
  return results
}

/** 추가 대장의 현행 `parent_card_id`(같은 귀속월의 정기 대장)입니다. 정기 대장이면 부르지 않습니다. */
async function parentOf(context: SignedInContext, ledger: PayrollLedger): Promise<string | null> {
  if (ledger.kind === 'REGULAR') return null
  return parentCardIdOf(ledger, await allLedgers(context, { attributionMonth: ledger.attributionMonth }))
}

/** 현행 카드 머리입니다. 행 집계가 들어가므로 행도 읽습니다. */
async function summaryOf(context: SignedInContext, ledger: PayrollLedger): Promise<Record<string, unknown>> {
  const [rows, parent] = await Promise.all([rowsOf(context, ledger), parentOf(context, ledger)])
  return toLegacySummary(ledger, rows, parent)
}

/** 현행 카드 상세(머리 + 소득 구분별 행)입니다. */
async function detailOf(context: SignedInContext, ledger: PayrollLedger): Promise<Record<string, unknown>> {
  const [rows, parent] = await Promise.all([rowsOf(context, ledger), parentOf(context, ledger)])
  return { ...toLegacySummary(ledger, rows, parent), ...groupedRows([{ ledger, rows }]) }
}

/** 같은 귀속월의 마감된 대장과 그 행입니다(현행 `fixed_cards_only`, `fixed-payrolls`). */
async function closedOfMonth(context: SignedInContext, ledger: PayrollLedger): Promise<LedgerWithRows[]> {
  return withRows(context, await allLedgers(context, { attributionMonth: ledger.attributionMonth, status: 'CLOSED' }))
}

/** 대장 커맨드를 보냅니다. `ifMatch`가 없으면 새 API가 버전을 보지 않습니다. `guard`는 보내기 직전의 확인입니다. */
async function command(
  context: SignedInContext,
  ledger: PayrollLedger,
  name: string,
  ifMatch: string | undefined,
  guard: SessionGuard | undefined,
  body?: unknown,
): Promise<Versioned> {
  const options: { body?: unknown; headers?: Record<string, string>; guard?: SessionGuard } = {}
  if (guard !== undefined) options.guard = guard
  if (body !== undefined) options.body = body
  if (ifMatch !== undefined) options.headers = { 'if-match': ifMatch }
  return versioned(
    await upstream(context, 'POST', `/v1/payroll-ledgers/${encodeURIComponent(ledger.id)}:${name}`, options),
  )
}

/** 현행 전이 거절입니다. 현행 서버와 같은 409 `INVALID_TRANSITION`입니다. */
function invalidTransition(action: string, ledger: PayrollLedger): LegacyError {
  return new LegacyError(409, {
    detail: `Cannot ${action} a payroll card that is ${legacyCardStatus(ledger.status)}.`,
    code: 'INVALID_TRANSITION',
  })
}

/**
 * 확정 해제의 두 번째 호출(`:return-to-draft`)이 실패했을 때 처리합니다. 현행 해제는 한 트랜잭션이었습니다.
 *
 * - 세션이 끝났으면(401) 되돌릴 수 없으므로 그 401을 그대로 줍니다
 * - 결과를 모르면(시간 초과·연결 실패·5xx) 이미 입력 상태로 돌아갔을 수 있으므로 되돌리지 않고 `PARTIAL_WRITE`입니다
 * - 새 API가 분명히 거절했으면(4xx) `:close`로 다시 마감해 되돌리고 그 거절을 줍니다
 * - 되돌리기가 실패하면 로그를 남기고(대장 ID와 상태만) 502 `PARTIAL_WRITE`, 되돌리기 중 세션이 끝났으면 그 401입니다
 *
 * @returns 던질 오류
 */
async function undoReopen(context: SignedInContext, reopened: Versioned, error: unknown): Promise<unknown> {
  const partial = (status: number) =>
    new LegacyError(status, {
      detail: 'The payroll card was reopened but may not be back in input. Reload the card before retrying.',
      code: 'PARTIAL_WRITE',
    })
  if (error instanceof LegacyError && error.status === 401) return error
  if (!(error instanceof LegacyError) || error.status >= 500) {
    return partial(error instanceof LegacyError ? error.status : 502)
  }
  // 되돌리기는 확인하지 않습니다. 그사이 행위자 종류가 바뀌어도 해제가 반쯤 된 대장을 남기지 않는 쪽이 낫습니다.
  const undone = await command(context, reopened.ledger, 'close', versionTag(reopened.ledger.version), undefined).catch(
    (failure: unknown) => failure,
  )
  if (!(undone instanceof Error)) return error
  if (undone instanceof LegacyError && undone.status === 401) return undone
  console.error('BFF: closing a payroll ledger again after a rejected release failed', {
    ledgerId: reopened.ledger.id,
    status: undone instanceof LegacyError ? undone.status : undefined,
  })
  return partial(502)
}

/**
 * 현행 확정·해제는 세무 대리인만 했습니다(현행 `legacyFix`·`legacyRelease`의 `actors: ['agency']`). 새 직접 운영은 고객도
 * 마감·마감 해제를 받지만, 정할 때까지 BFF가 고객으로 행동하는 사용자를 현행과 같은 403으로 막습니다.
 *
 * 기준은 사용자 종류가 아니라 **경로 회사에서의 행위자 종류**입니다. 세무 대리인 계정도 그 회사의 멤버면 현행·새 API 모두
 * 고객으로 다루기 때문입니다. 행위자 종류는 세션의 access token을 받은 새 API 세션 응답(`company.actorKind`)에서 옵니다.
 *
 * 확인은 {@link callApi}의 `guard`로, 대장 읽기와 각 커맨드를 보내기 직전에 그 호출의 토큰과 같은 grant로 합니다. 그래서 토큰이
 * 폐기돼(예: 멤버 가입) 401로 갱신하면 새 grant로 다시 확인하고, 커맨드는 늘 그것을 보내는 토큰의 행위자 종류로 막힙니다.
 * 세션의 회사는 `callApi`가 경로 회사로 맞춘 뒤라 따로 보지 않습니다. 첫 확인이 대장 읽기라 현행처럼 행위자가 상태보다 먼저입니다.
 */
function agencyOnly(action: string): SessionGuard {
  return (session) =>
    session.actorKind === 'AGENCY'
      ? undefined
      : new LegacyError(403, { detail: `Only agency staff may ${action} a payroll card.`, code: 'PERMISSION_DENIED' })
}

/** 현행 카드 이름(`name`)을 읽습니다. 현행처럼 앞뒤 공백을 빼고 1–100자입니다. */
function cardName(body: Record<string, unknown>, required: boolean): string | undefined {
  const value = body['name']
  if (value === undefined || value === null) {
    if (required) throw legacyErrors.invalidField('name', 'This field is required.')
    return undefined
  }
  if (typeof value !== 'string') throw legacyErrors.invalidField('name', 'Not a valid string.')
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > NAME_MAX) {
    throw legacyErrors.invalidField('name', `Ensure this field has 1 to ${NAME_MAX} characters.`)
  }
  return trimmed
}

/** 현행 `POST cards` 본문을 새 대장 생성 본문으로 옮깁니다. */
export function fromLegacyCreate(body: Record<string, unknown>): {
  attributionMonth: string
  paymentDate?: string
  title?: string
} {
  const month = body['attribution_month']
  if (month === undefined || month === null)
    throw legacyErrors.invalidField('attribution_month', 'This field is required.')
  if (typeof month !== 'string' || !isYearMonth(month)) {
    throw legacyErrors.invalidField('attribution_month', 'Expected a YYYY-MM month.')
  }
  const paymentDate = body['payment_date']
  if (
    paymentDate !== undefined &&
    paymentDate !== null &&
    (typeof paymentDate !== 'string' || !DATE.test(paymentDate))
  ) {
    throw legacyErrors.invalidField('payment_date', 'Expected a YYYY-MM-DD date.')
  }
  const title = cardName(body, false)
  return {
    attributionMonth: month,
    ...(typeof paymentDate === 'string' ? { paymentDate } : {}),
    ...(title === undefined ? {} : { title }),
  }
}

/** 현행 `card-summary`의 `year`입니다. 현행처럼 2000–2100의 정수입니다. */
function yearQuery(params: URLSearchParams): string | undefined {
  const raw = params.get('year')
  if (raw === null) return undefined
  const year = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(year) || year < 2000 || year > 2100) {
    throw legacyErrors.invalidField('year', 'Invalid value.')
  }
  return String(year)
}

/** 현행 `group-by-attr-date`의 쿼리입니다. */
function groupQuery(params: URLSearchParams): { fixedOnly: boolean; month?: string; status?: LegacyStatus } {
  const fixedOnly = booleanQuery(params, 'fixed_cards_only')
  const month = params.get('attr_date')
  if (month !== null && !isYearMonth(month)) throw legacyErrors.invalidField('attr_date', 'Expected a YYYY-MM month.')
  const status = params.get('status')
  if (status !== null && !(LEGACY_STATUSES as readonly string[]).includes(status)) {
    throw legacyErrors.invalidField('status', 'Invalid value.')
  }
  return {
    fixedOnly,
    ...(month === null ? {} : { month }),
    ...(status === null ? {} : { status: status as LegacyStatus }),
  }
}

function etagHeader(etag: string): Headers {
  return new Headers({ etag })
}

/**
 * 현행 급여카드(급여 관리)의 목록·상세·생성·이름 변경·삭제·계산 확정·확정·해제·추가 카드입니다.
 *
 * | 현행 (`/api/company/:companyId/payroll` 아래) | 새 API |
 * |---|---|
 * | `GET card-summary/` | `GET /v1/payroll-ledgers`(끝까지) + 대장마다 `GET …/rows` |
 * | `GET card-summary/group-by-attr-date/` | 같음, BFF가 귀속월로 묶음 |
 * | `POST cards/` | `POST /v1/payroll-ledgers` |
 * | `GET cards/:cardId/`, `card-status/`, `fixed-payrolls/` | `GET /v1/payroll-ledgers/{id}`, `…/rows` |
 * | `PATCH cards/:cardId/update-name/` | `PATCH /v1/payroll-ledgers/{id} { title }` |
 * | `DELETE cards/:cardId/` | `DELETE /v1/payroll-ledgers/{id}` (추가 대장만) |
 * | `POST cards/:cardId/calculate/` | `:submit` |
 * | `POST cards/:cardId/extensions/fix/` | `:close` (제출된 대장만) |
 * | `POST cards/:cardId/extensions/release/` | `:return-to-draft`, 마감된 대장은 `:reopen` + `:return-to-draft` |
 * | `POST cards/:cardId/additional-card/` | `POST /v1/payroll-ledgers { attributionMonth }` |
 *
 * 현행 카드 쓰기는 `If-Match`가 없었습니다. 클라이언트가 보내면 형식을 먼저 보고 새 API에 넘기며, 상태를 먼저 확인하는
 * 확정·해제는 보내지 않아도 BFF가 방금 읽은 버전을 넣어 읽은 뒤의 변경을 덮어쓰지 않습니다.
 */
export const payrollLedgerRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: `${BASE}/card-summary`,
    auth: true,
    handle: async (context) => {
      const year = yearQuery(context.url.searchParams)
      const ledgers = (await allLedgers(context)).filter(
        (ledger) => year === undefined || ledger.attributionMonth.startsWith(`${year}-`),
      )
      const sources = await withRows(context, ledgers)
      return json({
        results: sources.map(({ ledger, rows }) => toLegacySummary(ledger, rows, parentCardIdOf(ledger, ledgers))),
      })
    },
  },
  {
    method: 'GET',
    path: `${BASE}/card-summary/group-by-attr-date`,
    auth: true,
    handle: async (context) => {
      const query = groupQuery(context.url.searchParams)
      const ledgers = (
        await allLedgers(context, {
          ...(query.month === undefined ? {} : { attributionMonth: query.month }),
          ...(query.fixedOnly ? { status: 'CLOSED' as const } : {}),
        })
      ).filter((ledger) => query.status === undefined || legacyStatus(ledger.status) === query.status)
      const sources = await withRows(context, ledgers)
      const groups = new Map<string, LedgerWithRows[]>()
      for (const source of sources) {
        const month = source.ledger.attributionMonth
        groups.set(month, [...(groups.get(month) ?? []), source])
      }
      return json({
        results: [...groups].map(([month, members]) => ({
          attr_date: month,
          default_card: members.find(({ ledger }) => ledger.kind === 'REGULAR')?.ledger.id ?? null,
          additional_count: members.filter(({ ledger }) => ledger.kind === 'ADDITIONAL').length,
          cards: members.map(({ ledger, rows }) => toLegacySummary(ledger, rows, parentCardIdOf(ledger, ledgers))),
        })),
      })
    },
  },
  {
    method: 'POST',
    path: `${BASE}/cards`,
    auth: true,
    handle: async (context) => {
      const body = fromLegacyCreate(await readObject(context.request))
      const { ledger, etag } = await versioned(await upstream(context, 'POST', '/v1/payroll-ledgers', { body }))
      return json(await detailOf(context, ledger), 201, etagHeader(etag))
    },
  },
  {
    method: 'GET',
    path: CARD,
    auth: true,
    handle: async (context) => {
      const fixedOnly = booleanQuery(context.url.searchParams, 'fixed_cards_only')
      const { ledger, etag } = await ledgerOf(context)
      if (!fixedOnly) return json(await detailOf(context, ledger), 200, etagHeader(etag))
      const [members, summary] = await Promise.all([closedOfMonth(context, ledger), summaryOf(context, ledger)])
      return json(
        { ...summary, card_ids: members.map(({ ledger: member }) => member.id), ...groupedRows(members) },
        200,
        etagHeader(etag),
      )
    },
  },
  {
    method: 'DELETE',
    path: CARD,
    auth: true,
    handle: async (context) => {
      const ifMatch = optionalIfMatch(context.request)
      const { ledger } = await ledgerOf(context)
      // 현행은 추가 카드만 지울 수 있었습니다. 정기 카드는 월 배치가 만들고 지우지 않았습니다.
      if (ledger.kind !== 'ADDITIONAL') {
        throw new LegacyError(409, {
          detail: 'Only an additional payroll card can be deleted.',
          code: 'INVALID_TRANSITION',
        })
      }
      const response = await upstream(context, 'DELETE', ledgerPath(context), {
        ...(ifMatch === undefined ? {} : { headers: { 'if-match': ifMatch } }),
      })
      if (!response.ok) await read(response)
      return new Response(null, { status: 204 })
    },
  },
  {
    method: 'PATCH',
    path: `${CARD}/update-name`,
    auth: true,
    handle: async (context) => {
      const ifMatch = optionalIfMatch(context.request)
      const title = cardName(await readObject(context.request), true)
      const { ledger, etag } = await versioned(
        await upstream(context, 'PATCH', ledgerPath(context), {
          body: { title },
          ...(ifMatch === undefined ? {} : { headers: { 'if-match': ifMatch } }),
        }),
      )
      return json(await summaryOf(context, ledger), 200, etagHeader(etag))
    },
  },
  {
    method: 'POST',
    path: `${CARD}/calculate`,
    auth: true,
    handle: async (context) => {
      const ifMatch = optionalIfMatch(context.request)
      const path = ledgerPath(context)
      const response = await upstream(context, 'POST', `${path}:submit`, {
        ...(ifMatch === undefined ? {} : { headers: { 'if-match': ifMatch } }),
      })
      const { ledger, etag } = await versioned(response)
      return json(await summaryOf(context, ledger), 200, etagHeader(etag))
    },
  },
  {
    method: 'POST',
    path: `${CARD}/extensions/fix`,
    auth: true,
    handle: async (context) => {
      const ifMatch = optionalIfMatch(context.request)
      const guard = agencyOnly('fix')
      const current = await ledgerOf(context, guard)
      // 현행 확정은 계산을 마친 카드에서만 됐습니다. 새 `:close`는 입력 중인 대장도 받으므로 BFF가 막습니다.
      if (current.ledger.status !== 'SUBMITTED') throw invalidTransition('fix', current.ledger)
      const { ledger, etag } = await command(
        context,
        current.ledger,
        'close',
        ifMatch ?? versionTag(current.ledger.version),
        guard,
      )
      return json(await summaryOf(context, ledger), 200, etagHeader(etag))
    },
  },
  {
    method: 'POST',
    path: `${CARD}/extensions/release`,
    auth: true,
    handle: async (context) => {
      const ifMatch = optionalIfMatch(context.request)
      const guard = agencyOnly('release')
      const current = await ledgerOf(context, guard)
      const expected = ifMatch ?? versionTag(current.ledger.version)
      let released: Versioned
      if (current.ledger.status === 'SUBMITTED') {
        released = await command(context, current.ledger, 'return-to-draft', expected, guard)
      } else if (current.ledger.status === 'CLOSED' && current.ledger.workflow === 'DIRECT_CLOSE') {
        // 새 API에서는 마감 해제(`CLOSED` → `SUBMITTED`)와 입력으로 되돌리기가 두 커맨드입니다.
        const reopened = await command(context, current.ledger, 'reopen', expected, guard, { reason: RELEASE_REASON })
        try {
          released = await command(
            context,
            reopened.ledger,
            'return-to-draft',
            versionTag(reopened.ledger.version),
            guard,
          )
        } catch (error) {
          throw await undoReopen(context, reopened, error)
        }
      } else {
        throw invalidTransition('release', current.ledger)
      }
      return json(await summaryOf(context, released.ledger), 200, etagHeader(released.etag))
    },
  },
  {
    method: 'GET',
    path: `${CARD}/card-status`,
    auth: true,
    handle: async (context) => {
      const { ledger, etag } = await ledgerOf(context)
      return json(
        { id: ledger.id, status: legacyStatus(ledger.status), card_status: legacyCardStatus(ledger.status) },
        200,
        etagHeader(etag),
      )
    },
  },
  {
    method: 'GET',
    path: `${CARD}/fixed-payrolls`,
    auth: true,
    handle: async (context) => {
      const segment = parseLegacySegment(context.url.searchParams.get('income_type'))
      const { ledger } = await ledgerOf(context)
      const members = await closedOfMonth(context, ledger)
      const results = members.flatMap(({ ledger: member, rows }) =>
        rows
          .filter((row) => segment === undefined || legacySegment(row.incomeType) === segment)
          .map((row) => ({ card_id: member.id, ...toLegacyRow(member, row) })),
      )
      return json({ results })
    },
  },
  {
    method: 'POST',
    path: `${CARD}/additional-card`,
    auth: true,
    handle: async (context) => {
      const { ledger: parent } = await ledgerOf(context)
      const { ledger, etag } = await versioned(
        await upstream(context, 'POST', '/v1/payroll-ledgers', { body: { attributionMonth: parent.attributionMonth } }),
      )
      return json(await detailOf(context, ledger), 201, etagHeader(etag))
    },
  },
]
