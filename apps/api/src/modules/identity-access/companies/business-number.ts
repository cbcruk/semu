/** 검증번호(10번째 자리)를 구할 때 1~9번째 자리에 곱하는 국세청 가중치입니다. */
const 검증가중치 = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const

/**
 * 사업자등록번호에서 하이픈을 빼고 검증 숫자가 맞으면 숫자 10자리를, 아니면 `undefined`를 돌려줍니다.
 *
 * 국세청 검증 숫자 계산은 현행 구현(`apps/api/legacy/src/modules/platform/platform.utils.ts`)과 같습니다.
 *
 * @example
 * ```ts
 * normalizeBusinessNumber('123-81-45600') // '1238145600'
 * normalizeBusinessNumber('1238145601') // undefined
 * ```
 */
export function normalizeBusinessNumber(value: string): string | undefined {
  const 하이픈뺀번호 = value.replaceAll('-', '')
  return isValidBusinessNumber(하이픈뺀번호) ? 하이픈뺀번호 : undefined
}

/** 숫자 10자리 사업자등록번호의 검증 숫자가 맞는지입니다. */
export function isValidBusinessNumber(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false
  // 자리숫자: 각 자리의 숫자, 가중합: 자리숫자에 가중치를 곱해 더한 값(규칙 문서의 `sum`)입니다. 둘 다 지은 말입니다.
  const 자리숫자 = [...digits].map(Number)
  let 가중합 = 검증가중치.reduce((total, 가중치, index) => total + (자리숫자[index] ?? 0) * 가중치, 0)
  가중합 += Math.floor(((자리숫자[8] ?? 0) * 5) / 10)
  return (10 - (가중합 % 10)) % 10 === 자리숫자[9]
}

/**
 * 법인등록번호가 13자리 숫자(하이픈 허용)인지입니다. 검증 숫자는 보지 않습니다.
 *
 * 2025-01-31부터 부여하는 번호는 등기관서 4자리 + 법인종류 2자리 + 일련번호 7자리이고 오류검색번호가 없습니다
 * (법인 및 재외국민의 부동산등기용등록번호 부여에 관한 규칙 제2조 ①, 대법원규칙 제3173호 부칙). 그 전에 부여한 번호만
 * 마지막 자리가 오류검색번호라 두 형식을 번호만으로 가를 수 없습니다.
 */
export function isValidCorporateRegistrationNumber(value: string): boolean {
  return /^\d{13}$/.test(value.replaceAll('-', ''))
}
