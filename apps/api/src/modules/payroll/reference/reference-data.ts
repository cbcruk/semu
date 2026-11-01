import type { YearMonth } from '../engine/rate-table.types'
import type { BusinessIncomeType, NationCode, OtherIncomeType, ReferenceCode } from './reference.types'

const FROM = '2024-01'

function business(code: string, name: string, detailType: BusinessIncomeType['detailType']): BusinessIncomeType {
  return { code, name, detailType, effectiveFrom: FROM, effectiveTo: null, verified: false }
}

function other(code: string, name: string, expenseRatePpm: number | null, taxRatePpm = 200_000): OtherIncomeType {
  return { code, name, expenseRatePpm, taxRatePpm, effectiveFrom: FROM, effectiveTo: null, verified: false }
}

function occupation(code: string, name: string): ReferenceCode {
  return { code, name, effectiveFrom: FROM, effectiveTo: null, verified: false }
}

/**
 * 사업소득 업종코드 offered in the business income tab.
 *
 * Names in screen 36f51fbd (기타자영업(프리랜서), 가수, 간병인, 기타모집수당) are
 * confirmed; the numeric codes are recalled from the 간이지급명세서 list and unverified.
 */
export const BUSINESS_INCOME_TYPES: readonly BusinessIncomeType[] = [
  business('940100', '저술가', 'artist'),
  business('940200', '화가관련', 'artist'),
  business('940301', '작곡가', 'artist'),
  business('940302', '배우', 'artist'),
  business('940303', '모델', 'artist'),
  business('940304', '가수', 'artist'),
  business('940305', '성악가', 'artist'),
  business('940500', '연예보조', 'artist'),
  business('940600', '자문·고문', null),
  business('940903', '학원강사', null),
  business('940904', '직업운동가', null),
  business('940906', '보험설계사', 'special'),
  business('940908', '방판·외판원', 'special'),
  business('940909', '기타자영업(프리랜서)', null),
  business('940910', '다단계판매', null),
  business('940911', '기타모집수당', null),
  business('940912', '간병인', null),
  business('940913', '대리운전', 'special'),
  business('940914', '캐디', 'special'),
  business('940918', '퀵서비스', 'special'),
  business('940919', '물품배달', 'special'),
  business('940920', '학습지 방문강사', 'special'),
  business('940926', '소프트웨어 프리랜서', 'special'),
]

/** 특수형태근로종사자(노무제공자) 직종코드 for employment insurance. Codes are placeholders and unverified. */
export const SPECIAL_OCCUPATION_TYPES: readonly ReferenceCode[] = [
  occupation('01', '보험설계사'),
  occupation('02', '학습지 방문강사'),
  occupation('03', '교육교구 방문강사'),
  occupation('04', '택배기사'),
  occupation('05', '대출모집인'),
  occupation('06', '신용카드회원 모집인'),
  occupation('07', '방문판매원'),
  occupation('08', '대여제품 방문점검원'),
  occupation('09', '가전제품 배송설치기사'),
  occupation('10', '건설기계조종사'),
  occupation('11', '화물차주'),
  occupation('12', '퀵서비스기사'),
  occupation('13', '대리운전기사'),
  occupation('14', '소프트웨어기술자'),
  occupation('15', '골프장 캐디'),
]

/**
 * 기타소득 지급사유 with expense rules.
 *
 * Names follow screen 09009340; codes, the 서화·골동품 expense rate and the
 * pension-termination rate (15%) are unverified (spec 4.5).
 */
export const OTHER_INCOME_TYPES: readonly OtherIncomeType[] = [
  other('60', '그 밖에 필요경비 있는 기타소득', 600_000),
  other('62', '필요경비 없는 기타소득', 0),
  other('63', '서화·골동품 양도소득', 800_000),
  other('64', '주식매수선택권 행사이익', 0),
  other('67', '연금·공제부금해지소득', 0, 150_000),
  other('75', '원고료 등', 600_000),
  other('76', '강연료 등', 600_000),
  other('59', '실제 필요경비 기타소득', null),
]

/** Country codes (ISO 3166-1 alpha-2) offered as residence countries. */
export const NATION_CODES: readonly NationCode[] = [
  { code: 'KR', name: '대한민국' },
  { code: 'US', name: '미국' },
  { code: 'CN', name: '중국' },
  { code: 'JP', name: '일본' },
  { code: 'VN', name: '베트남' },
  { code: 'PH', name: '필리핀' },
  { code: 'TH', name: '태국' },
  { code: 'ID', name: '인도네시아' },
  { code: 'UZ', name: '우즈베키스탄' },
  { code: 'NP', name: '네팔' },
  { code: 'MN', name: '몽골' },
  { code: 'KH', name: '캄보디아' },
  { code: 'MM', name: '미얀마' },
  { code: 'LK', name: '스리랑카' },
  { code: 'BD', name: '방글라데시' },
  { code: 'KZ', name: '카자흐스탄' },
  { code: 'RU', name: '러시아' },
  { code: 'IN', name: '인도' },
  { code: 'PK', name: '파키스탄' },
  { code: 'TW', name: '대만' },
  { code: 'HK', name: '홍콩' },
  { code: 'CA', name: '캐나다' },
  { code: 'AU', name: '호주' },
  { code: 'GB', name: '영국' },
  { code: 'DE', name: '독일' },
  { code: 'FR', name: '프랑스' },
]

/** Keeps the codes valid in a month. */
export function codesInForce<T extends ReferenceCode>(codes: readonly T[], month: YearMonth): T[] {
  return codes.filter((code) => code.effectiveFrom <= month && (code.effectiveTo === null || code.effectiveTo >= month))
}

/** Finds an other-income type by code among those valid in a month. */
export function findOtherIncomeType(code: string, month: YearMonth): OtherIncomeType | undefined {
  return codesInForce(OTHER_INCOME_TYPES, month).find((type) => type.code === code)
}
