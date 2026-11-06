import { Context, Effect, Layer, Option } from 'effect'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import { paginate } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { nowAndToday } from '../common/lookup.ts'
import { accountDigits, maskAccountNumber } from '../common/masking.ts'
import {
  BusinessStatusCacheRepository,
  EvidenceRepository,
  PartnerRepository,
  SettlementLinkRepository,
} from '../common/repositories.ts'
import { evidenceAmounts } from '../evidence/evidence-amounts.ts'
import { PartnerNotFound } from '../evidence/evidence.ts'
import { AccountNumberCipher } from '../ports/account-number-cipher.ts'
import { BusinessStatusLookup } from '../ports/business-status-lookup.ts'
import { isBusinessStatusFresh, normalizeBusinessNumber } from './business-status-cache.ts'
import type { OutstandingAmounts } from './outstanding.ts'
import { outstandingByPartner } from './outstanding.ts'
import type { Partner } from './partner.ts'
import { PartnerBusinessNumberDuplicate, PartnerBusinessNumberRequired } from './partner.ts'
import type {
  BusinessStatusCacheRecord,
  PartnerContact,
  PartnerRecord,
  PartnerRole,
  PartnerType,
} from './partner.types.ts'

/** 거래처 입력입니다. 계좌번호 원문은 받자마자 암호화합니다. */
export interface PartnerInput {
  type: PartnerType
  roles: ReadonlyArray<PartnerRole>
  name: string
  representativeName: string
  businessNumber?: string | null
  businessType?: string | null
  businessItem?: string | null
  address?: string | null
  phoneNumber?: string | null
  memo?: string | null
  bankAccounts?: ReadonlyArray<{ bankCode: string; accountNumber: string; alias?: string | null; isPrimary?: boolean }>
  contacts?: ReadonlyArray<PartnerContact>
}

/** 사업자 상태조회 결과입니다. */
export interface BusinessStatusView {
  businessNumber: string
  status: BusinessStatusCacheRecord['status']
  taxationType: string | null
  closedOn: string | null
  checkedAt: string
}

function toPartner(row: PartnerRecord, outstanding: OutstandingAmounts | undefined): Partner {
  return {
    id: row.id,
    type: row.type,
    roles: [...row.roles],
    name: row.name,
    representativeName: row.representativeName,
    businessNumber: row.businessNumber,
    businessStatus: row.businessStatus,
    businessType: row.businessType,
    businessItem: row.businessItem,
    address: row.address,
    phoneNumber: row.phoneNumber,
    memo: row.memo,
    bankAccounts: row.bankAccounts.map((account) => ({
      bankCode: account.bankCode,
      accountNumberMasked: maskAccountNumber(`0000${account.accountNumberLast4}`),
      alias: account.alias,
      isPrimary: account.isPrimary,
    })),
    contacts: [...row.contacts],
    outstanding: outstanding ?? { salesAmount: 0, purchaseAmount: 0 },
    createdAt: row.createdAt,
    version: row.version,
  }
}

/** 사업자 휴·폐업 상태조회입니다. 같은 날 조회한 결과는 캐시에서 줍니다. */
export class BusinessStatusService extends Context.Service<
  BusinessStatusService,
  { check(businessNumber: string): Effect.Effect<BusinessStatusView> }
>()('semu/bookkeeping/BusinessStatusService') {
  static readonly layer = Layer.effect(
    BusinessStatusService,
    Effect.gen(function* () {
      const cache = yield* BusinessStatusCacheRepository
      const lookup = yield* BusinessStatusLookup
      const anyCompany = 'cmp_00000000000000000000000000' as Id<'company'>

      return BusinessStatusService.of({
        check: Effect.fn('BusinessStatusService.check')(function* (businessNumber) {
          const { now, today } = yield* nowAndToday
          const cached = yield* cache.findById(anyCompany, businessNumber)
          if (Option.isSome(cached) && isBusinessStatusFresh(cached.value.checkedAt, today)) {
            const { id, companyId: _company, ...rest } = cached.value
            return { businessNumber: id, ...rest }
          }
          const answer = yield* lookup.lookup(businessNumber)
          yield* cache.save({ id: businessNumber, companyId: null, ...answer, checkedAt: now })
          return { businessNumber, ...answer, checkedAt: now }
        }),
      })
    }),
  )
}

/** 거래처 관리입니다. 지우면 숨기기만 하고, 증빙·입출금의 연결은 그대로 둡니다. */
export class PartnerService extends Context.Service<
  PartnerService,
  {
    list(
      companyId: Id<'company'>,
      filter: { role?: PartnerRole; search?: string },
      page: PageQuery,
    ): Effect.Effect<PageOf<Partner>>
    get(companyId: Id<'company'>, id: Id<'partner'>): Effect.Effect<Partner, PartnerNotFound>
    create(
      companyId: Id<'company'>,
      input: PartnerInput,
    ): Effect.Effect<Partner, PartnerBusinessNumberDuplicate | PartnerBusinessNumberRequired>
    update(
      companyId: Id<'company'>,
      id: Id<'partner'>,
      changes: Partial<PartnerInput>,
      expectedVersion: number | undefined,
    ): Effect.Effect<
      Partner,
      PartnerNotFound | PartnerBusinessNumberDuplicate | PartnerBusinessNumberRequired | VersionMismatch
    >
    remove(companyId: Id<'company'>, id: Id<'partner'>): Effect.Effect<void, PartnerNotFound>
  }
>()('semu/bookkeeping/PartnerService') {
  static readonly layer = Layer.effect(
    PartnerService,
    Effect.gen(function* () {
      const repository = yield* PartnerRepository
      const evidence = yield* EvidenceRepository
      const links = yield* SettlementLinkRepository
      const cipher = yield* AccountNumberCipher
      const statuses = yield* BusinessStatusService

      const outstanding = Effect.fn('PartnerService.outstanding')(function* (companyId: Id<'company'>) {
        const linked = new Map<string, number>()
        for (const link of yield* links.list(companyId)) {
          linked.set(link.evidenceId, (linked.get(link.evidenceId) ?? 0) + link.amount)
        }
        return outstandingByPartner(
          (yield* evidence.list(companyId)).map((row) => ({
            side: row.side,
            partnerId: row.partnerId,
            classified: row.classification.accountTitleId !== null,
            totalAmount: evidenceAmounts(row).totalAmount,
            settledAmount: linked.get(row.id) ?? 0,
          })),
        )
      })

      const find = (companyId: Id<'company'>, id: Id<'partner'>) =>
        Effect.flatMap(repository.findById(companyId, id), (found) =>
          Option.isSome(found) && found.value.deletedAt === null
            ? Effect.succeed(found.value)
            : Effect.fail(new PartnerNotFound({})),
        )

      /** 사업자번호를 정리하고 중복·필수를 검사한 뒤 상태를 조회합니다. */
      const resolveBusiness = Effect.fn('PartnerService.resolveBusiness')(function* (
        companyId: Id<'company'>,
        type: PartnerType,
        raw: string | null | undefined,
        selfId: Id<'partner'> | null,
      ) {
        const businessNumber = raw === null || raw === undefined ? null : normalizeBusinessNumber(raw)
        if (businessNumber === null) {
          if (type !== 'NON_BUSINESS') return yield* new PartnerBusinessNumberRequired({})
          return { businessNumber: null, businessStatus: null }
        }
        const duplicate = (yield* repository.list(companyId)).find(
          (row) => row.deletedAt === null && row.businessNumber === businessNumber && row.id !== selfId,
        )
        if (duplicate !== undefined) return yield* new PartnerBusinessNumberDuplicate({ partnerId: duplicate.id })
        const status = yield* statuses.check(businessNumber)
        return { businessNumber, businessStatus: status.status }
      })

      const encryptAccounts = (accounts: PartnerInput['bankAccounts']) =>
        (accounts ?? []).map((account, index) => ({
          bankCode: account.bankCode,
          accountNumberEncrypted: cipher.encrypt('partnerAccount', accountDigits(account.accountNumber)),
          accountNumberLast4: accountDigits(account.accountNumber).slice(-4),
          alias: account.alias ?? null,
          isPrimary: account.isPrimary ?? index === 0,
        }))

      /** 같은 사업자번호의 거래처 없는 증빙을 이 거래처에 붙입니다. */
      const linkEvidence = Effect.fn('PartnerService.linkEvidence')(function* (partner: PartnerRecord) {
        if (partner.businessNumber === null) return
        const rows = (yield* evidence.list(partner.companyId)).filter(
          (row) => row.partnerId === null && row.counterpartyBusinessNumber === partner.businessNumber,
        )
        yield* evidence.saveAll(rows.map((row) => ({ ...row, partnerId: partner.id, version: row.version + 1 })))
      })

      return PartnerService.of({
        list: Effect.fn('PartnerService.list')(function* (companyId, filter, page) {
          const amounts = yield* outstanding(companyId)
          const term = filter.search?.trim().toLowerCase() ?? ''
          const rows = (yield* repository.list(companyId))
            .filter(
              (row) =>
                row.deletedAt === null &&
                (filter.role === undefined || row.roles.includes(filter.role)) &&
                (term === '' || `${row.name} ${row.businessNumber ?? ''}`.toLowerCase().includes(term)),
            )
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          const result = paginate(rows, (row) => `${row.name}\u0000${row.id}`, page)
          return { ...result, items: result.items.map((row) => toPartner(row, amounts.get(row.id))) }
        }),

        get: Effect.fn('PartnerService.get')(function* (companyId, id) {
          const row = yield* find(companyId, id)
          return toPartner(row, (yield* outstanding(companyId)).get(id))
        }),

        create: Effect.fn('PartnerService.create')(function* (companyId, input) {
          const business = yield* resolveBusiness(companyId, input.type, input.businessNumber, null)
          const { now } = yield* nowAndToday
          const record: PartnerRecord = {
            id: newId('partner'),
            companyId,
            type: input.type,
            roles: input.roles,
            name: input.name,
            representativeName: input.representativeName,
            ...business,
            businessType: input.businessType ?? null,
            businessItem: input.businessItem ?? null,
            address: input.address ?? null,
            phoneNumber: input.phoneNumber ?? null,
            memo: input.memo ?? null,
            bankAccounts: encryptAccounts(input.bankAccounts),
            contacts: input.contacts ?? [],
            createdAt: now,
            deletedAt: null,
            version: 1,
          }
          yield* repository.save(record)
          yield* linkEvidence(record)
          return toPartner(record, (yield* outstanding(companyId)).get(record.id))
        }),

        update: Effect.fn('PartnerService.update')(function* (companyId, id, changes, expectedVersion) {
          const row = yield* find(companyId, id)
          yield* checkVersion(row.version, expectedVersion)
          const type = changes.type ?? row.type
          const business =
            changes.businessNumber === undefined && changes.type === undefined
              ? { businessNumber: row.businessNumber, businessStatus: row.businessStatus }
              : yield* resolveBusiness(
                  companyId,
                  type,
                  changes.businessNumber === undefined ? row.businessNumber : changes.businessNumber,
                  id,
                )
          const { bankAccounts, ...plain } = changes
          const next: PartnerRecord = {
            ...row,
            ...Object.fromEntries(Object.entries(plain).filter(([, value]) => value !== undefined)),
            ...business,
            ...(bankAccounts === undefined ? {} : { bankAccounts: encryptAccounts(bankAccounts) }),
            version: row.version + 1,
          }
          yield* repository.save(next)
          yield* linkEvidence(next)
          return toPartner(next, (yield* outstanding(companyId)).get(id))
        }),

        remove: Effect.fn('PartnerService.remove')(function* (companyId, id) {
          const row = yield* find(companyId, id)
          const { now } = yield* nowAndToday
          yield* repository.save({ ...row, deletedAt: now, version: row.version + 1 })
        }),
      })
    }),
  )
}
