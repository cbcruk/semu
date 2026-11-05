import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { InstitutionType } from '../institutions/institution.ts'

/** 수집 레코드 종류입니다. Bookkeeping이 어느 원장(증빙·입출금·매출)에 넣을지 정하는 데 씁니다. */
export type ScrapedRecordKind =
  | 'TAX_INVOICE'
  | 'CASH_RECEIPT'
  | 'CARD_SALE'
  | 'CARD_APPROVAL'
  | 'BANK_TRANSACTION'
  | 'GIRO_BILL'
  | 'PG_SETTLEMENT'
  | 'ONLINE_SALE'

/** 기관에서 가져온 레코드 하나입니다. `payload`는 기관 원문을 정규화한 값입니다. */
export interface ScrapedRecord {
  kind: ScrapedRecordKind
  /** 기관 쪽 식별자입니다. 같은 레코드를 두 번 받아도 Bookkeeping이 한 번만 넣도록 씁니다. */
  externalId: string
  occurredOn: string
  /** 원 단위 정수입니다. */
  amount: number
  payload: Readonly<Record<string, unknown>>
}

/** 수집 요청 하나가 항목 하나에서 가져온 레코드 묶음입니다. */
export interface ScrapedBatch {
  companyId: Id<'company'>
  institutionType: InstitutionType
  integrationId: Id<'integration'>
  itemKey?: string
  scrapRequestId: Id<'scrapRequest'>
  /** 첫 수집이면 기관이 주는 최대 기간(예: 배달 90일)입니다. */
  isInitial: boolean
  records: ReadonlyArray<ScrapedRecord>
}

/**
 * 수집 레코드를 받는 쪽의 포트입니다. Integrations가 선언하고 Bookkeeping이 구현합니다.
 *
 * Integrations는 레코드를 저장하지 않고 이 포트로 넘기기만 합니다. 증빙·입출금 원장의 주인은 Bookkeeping입니다.
 */
export class ScrapedRecordSink extends Context.Service<
  ScrapedRecordSink,
  {
    accept(batch: ScrapedBatch): Effect.Effect<void>
  }
>()('semu/integrations/ScrapedRecordSink') {
  /** 받은 묶음을 `received` 배열에 쌓습니다. 테스트가 배열을 넘겨 확인합니다. */
  static readonly layerRecording = (received: ScrapedBatch[] = []) =>
    Layer.succeed(
      ScrapedRecordSink,
      ScrapedRecordSink.of({
        accept: (batch) =>
          Effect.sync(() => {
            received.push(batch)
          }),
      }),
    )
}
