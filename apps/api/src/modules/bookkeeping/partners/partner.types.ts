import type { Id } from '../../../shared/ids/ids.types.ts'
import type { BusinessStatus } from '../ports/business-status-lookup.ts'

/** 거래처 유형입니다. 사업자(법인·개인)와 비사업자(개인)입니다. */
export type PartnerType = 'CORPORATE_BUSINESS' | 'INDIVIDUAL_BUSINESS' | 'NON_BUSINESS'

/** 거래처 구분입니다. 매출처·매입처 중 하나 이상입니다. */
export type PartnerRole = 'SALES' | 'PURCHASE'

/** 거래처 계좌입니다. 원문은 암호문으로만 둡니다. */
export interface PartnerBankAccount {
  bankCode: string
  accountNumberEncrypted: string
  accountNumberLast4: string
  alias: string | null
  isPrimary: boolean
}

/** 거래처 담당자입니다. */
export interface PartnerContact {
  name: string
  department: string | null
  email: string | null
  phoneNumber: string | null
  mobileNumber: string | null
  faxNumber: string | null
}

/** 저장한 거래처입니다. 지우면 `deletedAt`만 채웁니다. */
export interface PartnerRecord {
  id: Id<'partner'>
  companyId: Id<'company'>
  type: PartnerType
  roles: ReadonlyArray<PartnerRole>
  name: string
  representativeName: string
  /** `-` 없는 숫자 10자리입니다. 비사업자는 `null`일 수 있습니다. */
  businessNumber: string | null
  businessStatus: BusinessStatus | null
  businessType: string | null
  businessItem: string | null
  address: string | null
  phoneNumber: string | null
  memo: string | null
  bankAccounts: ReadonlyArray<PartnerBankAccount>
  contacts: ReadonlyArray<PartnerContact>
  createdAt: string
  deletedAt: string | null
  version: number
}

/** 사업자 상태조회 캐시 한 행입니다. 회사와 상관없이 사업자번호로 둡니다. */
export interface BusinessStatusCacheRecord {
  /** 사업자번호입니다. */
  id: string
  companyId: null
  status: BusinessStatus
  taxationType: string | null
  closedOn: string | null
  /** 조회한 시각입니다. */
  checkedAt: string
}
