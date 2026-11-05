import { Effect, Layer } from 'effect'
import { ScrapedRecordIngestion } from '../modules/bookkeeping/bookkeeping.public.ts'
import type {
  ScrapedCardApproval,
  ScrapedEvidence,
  ScrapedGiroBill,
  ScrapedRecord as BookkeepingRecord,
} from '../modules/bookkeeping/bookkeeping.public.ts'
import { ScrapedRecordSink } from '../modules/integrations/integrations.public.ts'
import type { InstitutionType, ScrapedBatch, ScrapedRecord } from '../modules/integrations/integrations.public.ts'

type Payload = ScrapedRecord['payload']

/**
 * Integrations의 `ScrapedRecordSink` 포트를 Bookkeeping의 `ScrapedRecordIngestion`으로 구현합니다.
 *
 * Integrations의 레코드(`kind`, `externalId`, `occurredOn`, `amount`, 정규화한 `payload`)를 Bookkeeping 레코드로 바꿉니다.
 * - 세금계산서·현금영수증: `payload.side`가 `PURCHASE`면 매입, 아니면 매출 증빙입니다. 작성일자는 `payload.writtenOn`, 없으면 `occurredOn`입니다
 * - 카드 매출·PG 정산·온라인 매출: 매출 증빙입니다. 온라인 매출은 배달앱 연동이면 `DELIVERY`, 아니면 `MALL`입니다
 * - 카드 승인: 매입 카드 증빙이 되는 승인 기록입니다. 카드번호가 없으면 연동 항목 키를 씁니다
 * - 은행 거래: `payload.bankCode`·`payload.accountNumber`로 Bookkeeping 계좌에 맞춥니다. 없으면 Bookkeeping이 받지 않습니다
 * - 지로 고지서: 묶음의 고지서를 모아 전체 목록 하나로 넘깁니다
 *
 * 금액은 원 단위 그대로이고, `payload`에 공급가액·세액이 있으면 함께 넘깁니다. 받지 않은 레코드는 건수만 경고 로그로 남깁니다.
 */
export const IntegrationsRecordSinkFromBookkeeping: Layer.Layer<ScrapedRecordSink, never, ScrapedRecordIngestion> =
  Layer.effect(
    ScrapedRecordSink,
    Effect.gen(function* () {
      const ingestion = yield* ScrapedRecordIngestion
      return ScrapedRecordSink.of({
        accept: (batch) =>
          ingestion.ingest(batch.companyId, bookkeepingRecordsOf(batch)).pipe(
            Effect.flatMap((result) =>
              result.rejected.length === 0
                ? Effect.void
                : Effect.logWarning('scraped records rejected by bookkeeping', {
                    scrapRequestId: batch.scrapRequestId,
                    rejectedCount: result.rejected.length,
                    reasons: [...new Set(result.rejected.map((rejection) => rejection.reason))],
                  }),
            ),
          ),
      })
    }),
  )

/** Integrations의 수집 묶음을 Bookkeeping 레코드로 바꿉니다. 지로 고지서는 묶음마다 목록 하나가 됩니다. */
export function bookkeepingRecordsOf(batch: ScrapedBatch): BookkeepingRecord[] {
  const records: BookkeepingRecord[] = []
  const giroBills: ScrapedGiroBill[] = []
  for (const record of batch.records) {
    if (record.kind === 'GIRO_BILL') giroBills.push(giroBillOf(record))
    else records.push(recordOf(record, batch))
  }
  if (giroBills.length > 0) records.push({ type: 'GIRO_BILLS', bills: giroBills })
  return records
}

function recordOf(record: ScrapedRecord, batch: ScrapedBatch): BookkeepingRecord {
  switch (record.kind) {
    case 'TAX_INVOICE':
      return evidenceOf(record, sideOf(record.payload), 'TAX_INVOICE')
    case 'CASH_RECEIPT':
      return evidenceOf(record, sideOf(record.payload), 'CASH_RECEIPT')
    case 'CARD_SALE':
      return evidenceOf(record, 'SALES_EVIDENCE', 'CARD')
    case 'PG_SETTLEMENT':
      return evidenceOf(record, 'SALES_EVIDENCE', 'PG')
    case 'ONLINE_SALE':
      return evidenceOf(record, 'SALES_EVIDENCE', onlineSource(batch.institutionType))
    case 'CARD_APPROVAL':
      return cardApprovalOf(record, batch)
    case 'BANK_TRANSACTION':
      return {
        type: 'BANK_TRANSACTION',
        bankCode: text(record.payload, 'bankCode') ?? '',
        accountNumber: text(record.payload, 'accountNumber') ?? '',
        externalKey: record.externalId,
        transactedAt: text(record.payload, 'transactedAt') ?? startOfDay(record.occurredOn),
        amount: record.amount,
        ...optional('balanceAfter', amount(record.payload, 'balanceAfter')),
        ...optional('summary', text(record.payload, 'summary')),
      }
    case 'GIRO_BILL':
      return { type: 'GIRO_BILLS', bills: [giroBillOf(record)] }
  }
}

function evidenceOf(
  record: ScrapedRecord,
  type: ScrapedEvidence['type'],
  source: ScrapedEvidence['source'],
): ScrapedEvidence {
  const { payload } = record
  const cardNumber = text(payload, 'cardNumberMasked')
  return {
    type,
    source,
    externalKey: record.externalId,
    writtenOn: text(payload, 'writtenOn') ?? record.occurredOn,
    totalAmount: record.amount,
    isCanceled: flag(payload, 'isCanceled') ?? record.amount < 0,
    ...optional('issuedOn', text(payload, 'issuedOn')),
    ...optional('supplyAmount', amount(payload, 'supplyAmount')),
    ...optional('vatAmount', amount(payload, 'vatAmount')),
    ...optional('counterpartyName', text(payload, 'counterpartyName')),
    ...optional('counterpartyBusinessNumber', text(payload, 'counterpartyBusinessNumber')),
    ...optional('itemSummary', text(payload, 'itemSummary')),
    ...optional('channel', text(payload, 'channel')),
    ...optional('dedupeGroup', text(payload, 'dedupeGroup')),
    ...(cardNumber === undefined ? {} : { card: { numberMasked: cardNumber } }),
  }
}

function cardApprovalOf(record: ScrapedRecord, batch: ScrapedBatch): ScrapedCardApproval {
  const { payload } = record
  return {
    type: 'CARD_APPROVAL',
    cardNumberMasked: text(payload, 'cardNumberMasked') ?? batch.itemKey ?? '',
    approvalNo: text(payload, 'approvalNo') ?? record.externalId,
    approvedAt: text(payload, 'approvedAt') ?? startOfDay(record.occurredOn),
    amount: record.amount,
    isCanceled: flag(payload, 'isCanceled') ?? record.amount < 0,
    ...optional('cardCompanyCode', text(payload, 'cardCompanyCode')),
    ...optional('merchantName', text(payload, 'merchantName')),
    ...optional('merchantBusinessNumber', text(payload, 'merchantBusinessNumber')),
    ...optional('vatAmount', amount(payload, 'vatAmount')),
  }
}

function giroBillOf(record: ScrapedRecord): ScrapedGiroBill {
  const { payload } = record
  return {
    electronicPaymentNumber: text(payload, 'electronicPaymentNumber') ?? record.externalId,
    taxKind: text(payload, 'taxKind') === 'LOCAL' ? 'LOCAL' : 'NATIONAL',
    slipType: text(payload, 'slipType') ?? '',
    taxName: text(payload, 'taxName') ?? '',
    payAmount: record.amount,
    dueDate: text(payload, 'dueDate') ?? record.occurredOn,
    detail: { ...payload },
    ...optional('billingOrganization', text(payload, 'billingOrganization')),
    ...optional('isPaid', flag(payload, 'isPaid')),
  }
}

function sideOf(payload: Payload): ScrapedEvidence['type'] {
  return text(payload, 'side') === 'PURCHASE' ? 'PURCHASE_EVIDENCE' : 'SALES_EVIDENCE'
}

function onlineSource(type: InstitutionType): ScrapedEvidence['source'] {
  return type === 'DELIVERY' ? 'DELIVERY' : 'MALL'
}

function startOfDay(date: string): string {
  return `${date}T00:00:00+09:00`
}

function text(payload: Payload, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function amount(payload: Payload, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function flag(payload: Payload, key: string): boolean | undefined {
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}
