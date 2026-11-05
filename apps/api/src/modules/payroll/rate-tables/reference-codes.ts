import type { ReferenceCode } from './reference-codes.types.ts'

const FROM = '2024-01'

function other(code: string, name: string, expenseRatePpm: number | null, taxRatePpm = 200_000): ReferenceCode {
  return {
    code,
    name,
    expenseRatePpm,
    taxRatePpm,
    detailType: null,
    effectiveFrom: FROM,
    effectiveTo: null,
    verified: false,
  }
}

function business(code: string, name: string, detailType: 'ARTIST' | 'SPECIAL' | null): ReferenceCode {
  return {
    code,
    name,
    expenseRatePpm: null,
    taxRatePpm: null,
    detailType,
    effectiveFrom: FROM,
    effectiveTo: null,
    verified: false,
  }
}

/**
 * 기타소득 지급사유 코드입니다. 이름은 현행 화면에서 확인했고 코드·서화골동품 경비율·연금해지 세율(15%)은
 * 확인하지 못했습니다(스펙 4.5). `expenseRatePpm`이 `null`이면 실제 필요경비만 받습니다.
 */
export const OTHER_INCOME_CODES: readonly ReferenceCode[] = [
  other('60', '그 밖에 필요경비 있는 기타소득', 600_000),
  other('62', '필요경비 없는 기타소득', 0),
  other('63', '서화·골동품 양도소득', 800_000),
  other('64', '주식매수선택권 행사이익', 0),
  other('67', '연금·공제부금해지소득', 0, 150_000),
  other('75', '원고료 등', 600_000),
  other('76', '강연료 등', 600_000),
  other('59', '실제 필요경비 기타소득', null),
]

/**
 * 사업소득 업종코드입니다. 이름 일부(기타자영업(프리랜서)·가수·간병인·기타모집수당)만 화면에서 확인했고
 * 숫자 코드는 간이지급명세서 목록을 기억해 넣어 확인하지 못했습니다.
 */
export const BUSINESS_INCOME_CODES: readonly ReferenceCode[] = [
  business('940100', '저술가', 'ARTIST'),
  business('940200', '화가관련', 'ARTIST'),
  business('940301', '작곡가', 'ARTIST'),
  business('940302', '배우', 'ARTIST'),
  business('940303', '모델', 'ARTIST'),
  business('940304', '가수', 'ARTIST'),
  business('940305', '성악가', 'ARTIST'),
  business('940500', '연예보조', 'ARTIST'),
  business('940600', '자문·고문', null),
  business('940903', '학원강사', null),
  business('940904', '직업운동가', null),
  business('940906', '보험설계사', 'SPECIAL'),
  business('940908', '방판·외판원', 'SPECIAL'),
  business('940909', '기타자영업(프리랜서)', null),
  business('940910', '다단계판매', null),
  business('940911', '기타모집수당', null),
  business('940912', '간병인', null),
  business('940913', '대리운전', 'SPECIAL'),
  business('940914', '캐디', 'SPECIAL'),
  business('940918', '퀵서비스', 'SPECIAL'),
  business('940919', '물품배달', 'SPECIAL'),
  business('940920', '학습지 방문강사', 'SPECIAL'),
  business('940926', '소프트웨어 프리랜서', 'SPECIAL'),
]

/** 기본 기타소득 지급사유입니다. 현행처럼 `60`(필요경비 있는 기타소득)입니다. */
export const DEFAULT_OTHER_INCOME_CODE = '60'

/** 그 달에 쓸 수 있는 코드만 남깁니다. */
export function codesInForce(codes: readonly ReferenceCode[], month: string): ReferenceCode[] {
  return codes.filter((code) => code.effectiveFrom <= month && (code.effectiveTo === null || code.effectiveTo >= month))
}

/** 그 달에 쓸 수 있는 기타소득 지급사유를 찾습니다. */
export function findOtherIncomeCode(code: string, month: string): ReferenceCode | undefined {
  return codesInForce(OTHER_INCOME_CODES, month).find((entry) => entry.code === code)
}
