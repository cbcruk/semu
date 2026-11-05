/** 세목입니다. 현행 `reportEntryPoint`(`surtax`, `withholding-tax`, `corporation-tax`, `aggr-income-tax`)를 대신합니다. */
export type TaxType = 'VAT' | 'WITHHOLDING_TAX' | 'CORPORATE_TAX' | 'INCOME_TAX'

/**
 * 신고 건의 주기·종류입니다.
 *
 * - `PRELIMINARY`·`FINAL`: 부가세 예정·확정 신고. 간이과세자의 `FINAL`은 1년 과세기간의 신고입니다
 * - `NOTICE`: 신고서 없이 고지서로 납부합니다. 부가세 예정고지·간이과세자 예정부과, 종합소득세 중간예납입니다
 * - `MONTHLY`·`SEMIANNUAL`: 원천세 매월·반기 납부
 * - `INTERIM`: 법인세 중간예납 신고·납부
 * - `ANNUAL`: 법인세·종합소득세
 */
export type FilingKind = 'PRELIMINARY' | 'FINAL' | 'NOTICE' | 'MONTHLY' | 'SEMIANNUAL' | 'INTERIM' | 'ANNUAL'

/** 신고 건이 있는 단계입니다. 전이는 `filing-status.ts`의 표 하나가 정합니다. */
export type FilingStatus =
  | 'SCHEDULED'
  | 'REQUESTED'
  | 'SUBMITTED'
  | 'REVIEWING'
  | 'LEDGER_PENDING'
  | 'PREPARING'
  | 'FILED'
  | 'SETTLED'
  | 'CANCELED'

/** 신고 건 상태를 옮기는 커맨드입니다. `POST /filings/{filingId}:{command}`로 보냅니다. */
export type FilingCommand =
  | 'REQUEST'
  | 'SUBMIT'
  | 'UNSUBMIT'
  | 'START_REVIEW'
  | 'REJECT'
  | 'UPLOAD_LEDGER'
  | 'CONFIRM_LEDGER'
  | 'DISPUTE_LEDGER'
  | 'START_PREPARING'
  | 'FILE'
  | 'RECORD_NOTICE'
  | 'PAY'
  | 'CLOSE'
  | 'CANCEL'

/** 커맨드를 보낼 수 있는 행위자 종류입니다. 고객(`CLIENT`)과 세무 대리인(`AGENCY`)의 일이 나뉩니다. */
export type FilingActorKind = 'CLIENT' | 'AGENCY'

/** 종결한 신고 건이 어떻게 끝났는지입니다. 납부할 세액의 부호로 정합니다. */
export type FilingSettlement = 'PAID' | 'REFUND' | 'NO_PAYMENT'

/** 신고 건에 붙는 대리인 문서의 종류입니다. */
export type FilingDocumentType = 'LEDGER' | 'RETURN' | 'PAYMENT_SLIP' | 'NOTICE'

/** 제출 자료 항목에 대한 고객의 응답입니다. */
export type RequirementResponse = 'PENDING' | 'PROVIDED' | 'NOT_APPLICABLE'
