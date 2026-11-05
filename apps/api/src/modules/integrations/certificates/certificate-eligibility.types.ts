/** 인증서 명의입니다. `PERSONAL`은 대표자 개인, `BUSINESS`는 사업자(법인) 명의입니다. */
export type CertificateOwnerType = 'PERSONAL' | 'BUSINESS'

/** 인증서 용도입니다. `BANK`는 은행·카드·보험용, `ETAX`는 전자세금용입니다. */
export type CertificateUsage = 'GENERAL' | 'BANK' | 'ETAX'

/** 인증서 상태입니다. `EXPIRED`는 만료일로 파생하고, `UNREGISTERED`는 연동에 묶인 인증서가 삭제된 상태입니다. */
export type CertificateStatus = 'ACTIVE' | 'EXPIRED' | 'INACTIVE' | 'UNREGISTERED'

/** OID로 분류한 인증서 종류입니다. */
export interface CertificateClass {
  ownerType: CertificateOwnerType
  usage: CertificateUsage
  /** 발급기관 코드입니다. 예: `yessign` */
  issuerCode: string
}

/** 등록 검사에 쓰는 회사 정보입니다. */
export interface CertificateCompany {
  businessType: 'CORPORATION' | 'INDIVIDUAL'
  /** 하이픈 없는 10자리입니다. */
  businessNumber: string
  representativeNames: ReadonlyArray<string>
}

/** 로컬 인증서 프로그램이 읽어 올린 인증서의 공개 정보입니다. */
export interface CertificateFacts {
  oid: string
  /** 사업자 인증서의 사업자등록번호입니다. 하이픈이 있어도 됩니다. */
  ownerBusinessNumber?: string
  /** 개인 인증서의 소유자 이름입니다. */
  ownerName?: string
  expiresOn: string
}

/**
 * 등록을 거절한 이유입니다.
 *
 * - `CERTIFICATE_OID_UNKNOWN`: 분류표에 없는 OID
 * - `CERTIFICATE_EXPIRED`: 만료일이 오늘보다 이전
 * - `CERTIFICATE_TYPE_NOT_ALLOWED`: 법인이 개인 인증서를 올림
 * - `CERTIFICATE_OWNER_MISMATCH`: 사업자번호나 대표자 이름이 회사와 다름
 */
export type CertificateRejection =
  | { code: 'CERTIFICATE_OID_UNKNOWN'; field: 'oid' }
  | { code: 'CERTIFICATE_EXPIRED'; field: 'expiresOn' }
  | { code: 'CERTIFICATE_TYPE_NOT_ALLOWED'; field: 'oid' }
  | { code: 'CERTIFICATE_OWNER_MISMATCH'; field: 'ownerBusinessNumber' | 'ownerName' }

/** 등록 판정 결과입니다. */
export type CertificateRegistrationDecision =
  ({ ok: true } & CertificateClass) | { ok: false; rejection: CertificateRejection }
