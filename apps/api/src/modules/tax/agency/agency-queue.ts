import { Context, Effect, Layer } from 'effect'
import { paginate } from '../../../shared/http/pagination.ts'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { hasPermission } from '../../identity-access/actor.ts'
import type { Permission, Plan } from '../../identity-access/actor.types.ts'
import { compareClosedCards, compareOpenCards } from '../action-cards/action-card-rules.ts'
import type { ActionCardKind } from '../action-cards/action-card-rules.types.ts'
import type { ActionCardRecord } from '../action-cards/action-card.ts'
import { ActionCardRepository } from '../action-cards/action-card-repository.ts'
import { toActionCard } from '../action-cards/action-cards.ts'
import type { ActionCardTab } from '../action-cards/action-cards.ts'
import { isFilingOverdue } from '../filings/filing-progress.ts'
import { FilingRepository } from '../filings/filing-repository.ts'
import { allowedFilingCommands } from '../filings/filing-status.ts'
import type { FilingRecord } from '../filings/filing.types.ts'
import { toFilingSummary, transitionFacts } from '../filings/filing-view.ts'
import { CLOSED_STATUSES } from '../filings/filings.ts'
import { currentInstant, descendingKey } from '../tax-time.ts'
import type { FilingStatus, TaxType } from '../tax.types.ts'
import type { AgencyActionCard, AgencyFiling } from './agency-work.ts'

/**
 * 대리인 큐가 보는 회사 하나입니다. Identity & Access의 `authorizeAgency`가 거른 담당 회사를 그대로 넘깁니다.
 *
 * Tax는 배정을 모릅니다. 넘어온 회사만 읽습니다.
 */
export interface QueueCompany {
  companyId: Id<'company'>
  name: string
  plans: ReadonlySet<Plan>
}

/** 대리인 신고 건 큐의 조건입니다. 기한은 신고 기한, 없으면 납부 기한(`dueDate ?? paymentDue`)입니다. */
export interface AgencyFilingQuery extends PageQuery {
  companyId?: Id<'company'>
  taxType?: TaxType
  status?: FilingStatus
  /** `true`면 끝나지 않은 신고 건만, `false`면 끝난 신고 건만입니다. */
  open?: boolean
  /** `true`면 기한이 지난 신고 건만, `false`면 지나지 않은 신고 건만입니다. */
  overdue?: boolean
  /** 기한이 이날 이후인 신고 건만입니다. 기한이 없는 신고 건은 빠집니다. */
  dueFrom?: string
  /** 기한이 이날 이전인 신고 건만입니다. 기한이 없는 신고 건은 빠집니다. */
  dueTo?: string
}

/** 대리인 할 일 카드 큐의 조건입니다. */
export interface AgencyActionCardQuery extends PageQuery {
  companyId?: Id<'company'>
  kind?: ActionCardKind
}

/** 회사 하나의 세무 일감 개수입니다. Identity & Access의 담당 회사 목록이 씁니다. */
export interface QueueCompanyWorkload {
  companyId: Id<'company'>
  openFilingCount: number
  overdueFilingCount: number
  openActionCardCount: number
  nearestDueDate: string | null
}

/** 신고 건을 보는 데 필요한 플랜입니다. 회사 범위의 `GET /filings`와 같습니다. */
const FILING_PLANS: ReadonlyArray<Plan> = ['TAXATION']

/**
 * 세무 대리인의 여러 회사 작업 큐입니다. 회사 범위 저장소 조회를 담당 회사마다 반복해 한 목록으로 합칩니다.
 *
 * 쓰기는 하지 않습니다. 신고 건 커맨드는 그 회사 토큰으로 `POST /filings/{filingId}:{command}`를 부릅니다.
 */
export class AgencyQueue extends Context.Service<
  AgencyQueue,
  {
    /** 담당 회사들의 신고 건입니다. 기한이 가까운 순(기한 없는 것은 끝)입니다. `companies`는 `TAXATION` 회사여야 합니다. */
    filings(companies: ReadonlyArray<QueueCompany>, query: AgencyFilingQuery): Effect.Effect<PageOf<AgencyFiling>>
    /** 담당 회사들의 할 일 카드 한 탭입니다. 정렬은 회사 범위 목록과 같습니다. */
    actionCards(
      companies: ReadonlyArray<QueueCompany>,
      permissions: ReadonlySet<Permission>,
      tab: ActionCardTab,
      query: AgencyActionCardQuery,
    ): Effect.Effect<PageOf<AgencyActionCard>>
    /** 회사마다 일감 개수를 셉니다. 넘긴 순서대로 하나씩 돌려줍니다. */
    workload(
      companies: ReadonlyArray<Pick<QueueCompany, 'companyId' | 'plans'>>,
    ): Effect.Effect<ReadonlyArray<QueueCompanyWorkload>>
  }
>()('semu/tax/AgencyQueue') {
  static readonly layer = Layer.effect(
    AgencyQueue,
    Effect.gen(function* () {
      const filingRepository = yield* FilingRepository
      const cardRepository = yield* ActionCardRepository

      const filings = Effect.fn('AgencyQueue.filings')(function* (
        companies: ReadonlyArray<QueueCompany>,
        query: AgencyFilingQuery,
      ) {
        const { today } = yield* currentInstant
        const selected: Array<{ filing: FilingRecord; company: QueueCompany }> = []
        for (const company of companies) {
          if (query.companyId !== undefined && company.companyId !== query.companyId) continue
          const records = yield* filingRepository.list(company.companyId, {
            ...(query.taxType === undefined ? {} : { taxTypes: [query.taxType] }),
            ...(query.status === undefined ? {} : { statuses: [query.status] }),
          })
          for (const filing of records) {
            if (matchesFilingQuery(filing, query, today)) selected.push({ filing, company })
          }
        }
        const sorted = selected.toSorted((a, b) => {
          const left = filingQueueKey(a.filing)
          const right = filingQueueKey(b.filing)
          return left < right ? -1 : left > right ? 1 : 0
        })
        const page = paginate(sorted, (entry) => filingQueueKey(entry.filing), query)
        return {
          ...page,
          items: page.items.map(({ filing, company }): AgencyFiling => ({
            ...toFilingSummary(filing, today),
            company: { id: company.companyId, name: company.name },
            allowedActions: allowedFilingCommands(filing.status, 'AGENCY', transitionFacts(filing)),
          })),
        }
      })

      const visibleCards = (
        company: Pick<QueueCompany, 'companyId' | 'plans'>,
        permissions?: ReadonlySet<Permission>,
      ) =>
        cardRepository
          .listByCompany(company.companyId)
          .pipe(Effect.map((cards) => cards.filter((card) => canSee(card, company.plans, permissions))))

      const actionCards = Effect.fn('AgencyQueue.actionCards')(function* (
        companies: ReadonlyArray<QueueCompany>,
        permissions: ReadonlySet<Permission>,
        tab: ActionCardTab,
        query: AgencyActionCardQuery,
      ) {
        const selected: Array<{ card: ActionCardRecord; company: QueueCompany }> = []
        for (const company of companies) {
          if (query.companyId !== undefined && company.companyId !== query.companyId) continue
          for (const card of yield* visibleCards(company, permissions)) {
            if ((card.status === 'OPEN') !== (tab === 'OPEN')) continue
            if (query.kind !== undefined && card.kind !== query.kind) continue
            selected.push({ card, company })
          }
        }
        const page =
          tab === 'OPEN'
            ? paginate(
                selected.toSorted((a, b) => compareOpenCards(a.card, b.card)),
                ({ card }) => `${card.dueDate ?? '9999-12-31'}|${card.createdAt}|${card.id}`,
                query,
              )
            : paginate(
                selected.toSorted((a, b) => compareClosedCards(a.card, b.card)),
                ({ card }) => `${descendingKey(card.completedAt ?? '')}|${descendingKey(card.id)}`,
                query,
              )
        return {
          ...page,
          items: page.items.map(({ card, company }): AgencyActionCard => ({
            ...toActionCard(card),
            company: { id: company.companyId, name: company.name },
          })),
        }
      })

      const workload = Effect.fn('AgencyQueue.workload')(function* (
        companies: ReadonlyArray<Pick<QueueCompany, 'companyId' | 'plans'>>,
      ) {
        const { today } = yield* currentInstant
        const result: QueueCompanyWorkload[] = []
        for (const company of companies) {
          const open = FILING_PLANS.some((plan) => company.plans.has(plan))
            ? (yield* filingRepository.list(company.companyId)).filter(
                (filing) => !CLOSED_STATUSES.includes(filing.status),
              )
            : []
          const dueDates = open.flatMap((filing) => {
            const due = filing.dueDate ?? filing.paymentDue
            return due === null ? [] : [due]
          })
          const cards = yield* visibleCards(company)
          result.push({
            companyId: company.companyId,
            openFilingCount: open.length,
            overdueFilingCount: open.filter((filing) => isFilingOverdue(filing, today)).length,
            openActionCardCount: cards.filter((card) => card.status === 'OPEN').length,
            nearestDueDate: dueDates.toSorted()[0] ?? null,
          })
        }
        return result
      })

      return AgencyQueue.of({ filings, actionCards, workload })
    }),
  )
}

/** 신고 건 큐의 정렬·커서 키입니다. 기한 오름차순, 기한이 없으면 끝, 같으면 ID 순입니다. */
function filingQueueKey(filing: FilingRecord): string {
  return `${filing.dueDate ?? filing.paymentDue ?? '9999-12-31'}|${filing.id}`
}

function matchesFilingQuery(filing: FilingRecord, query: AgencyFilingQuery, today: string): boolean {
  if (query.open !== undefined && query.open === CLOSED_STATUSES.includes(filing.status)) return false
  if (query.overdue !== undefined && query.overdue !== isFilingOverdue(filing, today)) return false
  const due = filing.dueDate ?? filing.paymentDue
  if (query.dueFrom !== undefined && (due === null || due < query.dueFrom)) return false
  if (query.dueTo !== undefined && (due === null || due > query.dueTo)) return false
  return true
}

/**
 * 대리인이 카드를 볼 수 있는지입니다. 회사 범위와 같이 카드에 저장한 요건(권한 + 플랜)을 봅니다.
 *
 * `permissions`가 없으면(일감 개수) 권한은 보지 않고 플랜만 봅니다.
 */
function canSee(
  card: ActionCardRecord,
  plans: ReadonlySet<Plan>,
  permissions: ReadonlySet<Permission> | undefined,
): boolean {
  const required = card.requires.plans
  if (required.length > 0 && !required.some((plan) => plans.has(plan))) return false
  return permissions === undefined || hasPermission({ permissions }, card.requires.permission)
}
