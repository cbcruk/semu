import { createHash } from 'node:crypto'
import { Context, DateTime, Effect, Layer } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { companyDateOf } from '../../../shared/time/date-format.ts'
import { derivedClosing, mergeSnapshot } from '../bank/balance-snapshot.ts'
import type { BalanceSnapshotRecord, BankAccountRecord, BankTransactionRecord } from '../bank/bank.types.ts'
import { Classifier } from '../classification/classifier.ts'
import { accountDigits } from '../common/masking.ts'
import {
  BalanceSnapshotRepository,
  BankAccountRepository,
  BankTransactionRepository,
  EvidenceRepository,
  GiroRepository,
  PartnerRepository,
} from '../common/repositories.ts'
import type { EvidenceRecord } from '../evidence/evidence.types.ts'
import { refreshStep } from '../giros/giro-status.ts'
import type { GiroRecord } from '../giros/giro.types.ts'
import { normalizeBusinessNumber } from '../partners/business-status-cache.ts'
import { AccountNumberCipher } from '../ports/account-number-cipher.ts'
import { cardApprovalEvidence, evidenceRejection, processingOrder } from './ingestion-plan.ts'
import type { IngestionResult, ScrapedEvidence, ScrapedRecord } from './scraped-record.types.ts'

/** 은행 코드와 계좌번호 숫자로 만든 계좌 맞춤 키입니다. 원문을 저장하지 않고 수집 레코드를 기존 계좌에 맞춥니다. */
export function accountNumberDigest(bankCode: string, accountNumber: string): string {
  return createHash('sha256')
    .update(`${bankCode}:${accountDigits(accountNumber)}`)
    .digest('hex')
}

/**
 * 수집 레코드 수신 서비스입니다. Integrations가 스크래핑 결과를 이 서비스로 넘깁니다 (`bookkeeping.public.ts`).
 *
 * - 같은 `externalKey`가 다시 오면 수집 값만 덮어쓰고 분류·거래처·메모는 지킵니다(멱등)
 * - 받을 수 없는 레코드는 건너뛰고 `rejected`에 위치와 이유를 남깁니다. 나머지는 받습니다
 * - 새로 들어온 증빙·거래에는 규칙을 빈 항목만 채우기로 적용합니다
 */
export class ScrapedRecordIngestion extends Context.Service<
  ScrapedRecordIngestion,
  {
    ingest(companyId: Id<'company'>, records: ReadonlyArray<ScrapedRecord>): Effect.Effect<IngestionResult>
  }
>()('semu/bookkeeping/ScrapedRecordIngestion') {
  static readonly layer = Layer.effect(
    ScrapedRecordIngestion,
    Effect.gen(function* () {
      const evidenceRepo = yield* EvidenceRepository
      const accountRepo = yield* BankAccountRepository
      const transactionRepo = yield* BankTransactionRepository
      const snapshotRepo = yield* BalanceSnapshotRepository
      const partnerRepo = yield* PartnerRepository
      const giroRepo = yield* GiroRepository
      const cipher = yield* AccountNumberCipher
      const classifier = yield* Classifier

      const ingest = Effect.fn('ScrapedRecordIngestion.ingest')(function* (
        companyId: Id<'company'>,
        records: ReadonlyArray<ScrapedRecord>,
      ) {
        const now = DateTime.formatIso(yield* DateTime.now)
        const accounts = new Map((yield* accountRepo.list(companyId)).map((row) => [row.accountNumberDigest, row]))
        const transactions = new Map(
          (yield* transactionRepo.list(companyId)).map((row) => [`${row.bankAccountId}|${row.externalKey}`, row]),
        )
        const snapshots = new Map((yield* snapshotRepo.list(companyId)).map((row) => [row.id, row]))
        const evidence = new Map(
          (yield* evidenceRepo.list(companyId)).map((row) => [`${row.side}|${row.source}|${row.externalKey}`, row]),
        )
        const partnersByNumber = new Map(
          (yield* partnerRepo.list(companyId)).flatMap((partner) =>
            partner.deletedAt === null && partner.businessNumber !== null ? [[partner.businessNumber, partner.id]] : [],
          ),
        )
        const giros = new Map((yield* giroRepo.list(companyId)).map((row) => [row.electronicPaymentNumber, row]))

        const result: IngestionResult = { insertedCount: 0, updatedCount: 0, rejected: [], classifiedCount: 0 }
        const changedAccounts = new Map<string, BankAccountRecord>()
        const changedTransactions = new Map<string, BankTransactionRecord>()
        const changedSnapshots = new Map<string, BalanceSnapshotRecord>()
        const changedEvidence = new Map<string, EvidenceRecord>()
        const changedGiros = new Map<string, GiroRecord>()
        const touchedDays = new Set<string>()
        const newRows = { SALES: new Set<string>(), PURCHASE: new Set<string>(), BANK: new Set<string>() }
        const count = (inserted: boolean): void => {
          if (inserted) result.insertedCount++
          else result.updatedCount++
        }

        const putSnapshot = (incoming: BalanceSnapshotRecord): void => {
          const current = changedSnapshots.get(incoming.id) ?? snapshots.get(incoming.id)
          if (mergeSnapshot(current, incoming) === 'REPLACE') changedSnapshots.set(incoming.id, incoming)
        }

        const putEvidence = (index: number, record: ScrapedEvidence): void => {
          const rejection = evidenceRejection(record)
          if (rejection !== undefined) {
            result.rejected.push({ index, reason: rejection })
            return
          }
          const side = record.type === 'SALES_EVIDENCE' ? 'SALES' : 'PURCHASE'
          const key = `${side}|${record.source}|${record.externalKey}`
          const current = changedEvidence.get(key) ?? evidence.get(key)
          const businessNumber =
            record.counterpartyBusinessNumber === undefined
              ? null
              : normalizeBusinessNumber(record.counterpartyBusinessNumber)
          const scraped = {
            writtenOn: record.writtenOn,
            issuedOn: record.issuedOn ?? record.writtenOn,
            docType: record.docType ?? null,
            kind: record.kind ?? null,
            counterpartyName: record.counterpartyName ?? null,
            counterpartyBusinessNumber: businessNumber,
            itemSummary: record.itemSummary ?? null,
            totalAmount: record.totalAmount ?? null,
            supplyAmount: record.supplyAmount ?? null,
            vatAmount: record.vatAmount ?? null,
            card:
              record.card === undefined
                ? null
                : {
                    numberMasked: record.card.numberMasked,
                    companyCode: record.card.companyCode ?? null,
                    approvalNo: record.card.approvalNo ?? null,
                  },
            channel: record.channel ?? null,
            isCanceled: record.isCanceled ?? false,
            dedupeGroup: record.dedupeGroup ?? null,
            syncedAt: now,
          }
          const linkedPartner = businessNumber === null ? null : (partnersByNumber.get(businessNumber) ?? null)
          if (current !== undefined) {
            changedEvidence.set(key, {
              ...current,
              ...scraped,
              partnerId: current.partnerId ?? linkedPartner,
              vatDeduction: side === 'PURCHASE' ? (record.vatDeduction ?? current.vatDeduction) : 'UNDECIDED',
              version: current.version + 1,
            })
            count(false)
            return
          }
          const id = newId('evidence')
          changedEvidence.set(key, {
            id,
            companyId,
            side,
            source: record.source,
            externalKey: record.externalKey,
            ...scraped,
            partnerId: linkedPartner,
            classification: { accountTitleId: null, method: null, ruleId: null },
            memo: null,
            vatDeduction: side === 'PURCHASE' ? (record.vatDeduction ?? 'UNDECIDED') : 'UNDECIDED',
            salesTransactionId: null,
            version: 1,
          })
          newRows[side].add(id)
          count(true)
        }

        const findAccount = (bankCode: string, accountNumber: string): BankAccountRecord | undefined => {
          const digest = accountNumberDigest(bankCode, accountNumber)
          return changedAccounts.get(digest) ?? accounts.get(digest)
        }

        for (const index of processingOrder(records)) {
          const record = records[index]!
          switch (record.type) {
            case 'BANK_ACCOUNT': {
              const digest = accountNumberDigest(record.bankCode, record.accountNumber)
              const current = changedAccounts.get(digest) ?? accounts.get(digest)
              const scraped = {
                accountTypeCode: record.accountTypeCode,
                isCorporate: record.isCorporate ?? true,
                currencyCode: record.currencyCode ?? 'KRW',
                holder: record.holder ?? null,
                openedOn: record.openedOn ?? null,
                maturesOn: record.maturesOn ?? null,
                balance: record.balance ?? null,
                status: record.status ?? 'ACTIVE',
              }
              changedAccounts.set(
                digest,
                current === undefined
                  ? {
                      id: newId('bankAccount'),
                      companyId,
                      bankCode: record.bankCode,
                      accountNumberEncrypted: cipher.encrypt('companyAccount', accountDigits(record.accountNumber)),
                      accountNumberDigest: digest,
                      accountNumberLast4: accountDigits(record.accountNumber).slice(-4),
                      alias: record.alias ?? null,
                      ...scraped,
                      cashReport: 'INCLUDED',
                      lastTransactionOn: null,
                      version: 1,
                    }
                  : {
                      ...current,
                      ...scraped,
                      alias: current.alias ?? record.alias ?? null,
                      version: current.version + 1,
                    },
              )
              count(current === undefined)
              break
            }
            case 'BANK_TRANSACTION': {
              const account = findAccount(record.bankCode, record.accountNumber)
              if (account === undefined) {
                result.rejected.push({ index, reason: 'BANK_ACCOUNT_UNKNOWN' })
                break
              }
              const date = companyDateOf(record.transactedAt)
              if (date === null) {
                result.rejected.push({ index, reason: 'DATE_INVALID' })
                break
              }
              const key = `${account.id}|${record.externalKey}`
              const current = changedTransactions.get(key) ?? transactions.get(key)
              const scraped = {
                transactedAt: record.transactedAt,
                direction: record.amount < 0 ? ('WITHDRAWAL' as const) : ('DEPOSIT' as const),
                amount: record.amount,
                balanceAfter: record.balanceAfter ?? null,
                summary: record.summary ?? null,
                currencyCode: record.currencyCode ?? 'KRW',
                syncedAt: now,
              }
              if (current === undefined) {
                const id = newId('bankTransaction')
                changedTransactions.set(key, {
                  id,
                  companyId,
                  bankAccountId: account.id,
                  externalKey: record.externalKey,
                  ...scraped,
                  partnerId: null,
                  classification: { accountTitleId: null, method: null, ruleId: null },
                  memo: null,
                  version: 1,
                })
                newRows.BANK.add(id)
              } else {
                changedTransactions.set(key, { ...current, ...scraped, version: current.version + 1 })
              }
              touchedDays.add(`${account.id}|${date}`)
              if (account.lastTransactionOn === null || account.lastTransactionOn < date) {
                changedAccounts.set(account.accountNumberDigest, {
                  ...account,
                  lastTransactionOn: date,
                })
              }
              count(current === undefined)
              break
            }
            case 'BANK_BALANCE': {
              const account = findAccount(record.bankCode, record.accountNumber)
              if (account === undefined) {
                result.rejected.push({ index, reason: 'BANK_ACCOUNT_UNKNOWN' })
                break
              }
              const id = `${account.id}:${record.date}`
              const existed = snapshots.has(id) || changedSnapshots.has(id)
              putSnapshot({
                id,
                companyId,
                bankAccountId: account.id,
                date: record.date,
                closingBalance: record.closingBalance,
                source: 'SCRAPED',
              })
              count(!existed)
              break
            }
            case 'CARD_APPROVAL':
              putEvidence(index, cardApprovalEvidence(record))
              break
            case 'SALES_EVIDENCE':
            case 'PURCHASE_EVIDENCE':
              putEvidence(index, record)
              break
            case 'GIRO_BILLS': {
              const seen = new Map(record.bills.map((bill) => [bill.electronicPaymentNumber, bill]))
              const numbers = new Set([...giros.keys(), ...seen.keys()])
              for (const number of numbers) {
                const current = changedGiros.get(number) ?? giros.get(number)
                const bill = seen.get(number)
                const step = refreshStep(current, bill === undefined ? undefined : { isPaid: bill.isPaid ?? false })
                if (step === undefined) continue
                const history =
                  step.action === null ? [] : [{ type: step.action, memo: '', actorUserId: null, at: now }]
                const billFields =
                  bill === undefined
                    ? {}
                    : {
                        taxKind: bill.taxKind,
                        slipType: bill.slipType,
                        taxName: bill.taxName,
                        billingOrganization: bill.billingOrganization ?? null,
                        payAmount: bill.payAmount,
                        dueDate: bill.dueDate ?? null,
                        detail: bill.detail,
                      }
                if (step.kind === 'INSERT' && bill !== undefined) {
                  changedGiros.set(number, {
                    id: newId('giro'),
                    companyId,
                    electronicPaymentNumber: number,
                    taxKind: bill.taxKind,
                    slipType: bill.slipType,
                    taxName: bill.taxName,
                    billingOrganization: bill.billingOrganization ?? null,
                    payAmount: bill.payAmount,
                    dueDate: bill.dueDate ?? null,
                    detail: bill.detail,
                    status: step.status,
                    doneReason: step.doneReason,
                    memo: '',
                    statusChangedAt: now,
                    history,
                    version: 1,
                  })
                  count(true)
                } else if (current !== undefined) {
                  const statusChanged = step.status !== current.status
                  changedGiros.set(number, {
                    ...current,
                    ...billFields,
                    status: step.status,
                    doneReason: step.doneReason,
                    statusChangedAt: statusChanged ? now : current.statusChangedAt,
                    history: [...current.history, ...history],
                    version: current.version + 1,
                  })
                  count(false)
                }
              }
              break
            }
          }
        }

        const allTransactions = [...new Map([...transactions, ...changedTransactions]).values()]
        for (const day of touchedDays) {
          const [accountId, date] = day.split('|') as [Id<'bankAccount'>, string]
          const closing = derivedClosing(
            allTransactions.filter(
              (row) => row.bankAccountId === accountId && companyDateOf(row.transactedAt) === date,
            ),
          )
          if (closing === undefined) continue
          putSnapshot({
            id: `${accountId}:${date}`,
            companyId,
            bankAccountId: accountId,
            date,
            closingBalance: closing,
            source: 'DERIVED',
          })
        }

        yield* accountRepo.saveAll([...changedAccounts.values()])
        yield* transactionRepo.saveAll([...changedTransactions.values()])
        yield* snapshotRepo.saveAll([...changedSnapshots.values()])
        yield* evidenceRepo.saveAll([...changedEvidence.values()])
        yield* giroRepo.saveAll([...changedGiros.values()])

        for (const scope of ['SALES', 'PURCHASE', 'BANK'] as const) {
          if (newRows[scope].size === 0) continue
          const applied = yield* classifier.apply(companyId, scope, { mode: 'FILL_EMPTY', rowIds: newRows[scope] })
          result.classifiedCount += applied.updatedCount
        }
        return result
      })

      return ScrapedRecordIngestion.of({ ingest })
    }),
  )
}
