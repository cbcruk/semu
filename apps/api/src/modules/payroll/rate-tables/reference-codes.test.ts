import { describe, expect, it } from 'vitest'
import { BUSINESS_INCOME_CODES, DEFAULT_OTHER_INCOME_CODE, OTHER_INCOME_CODES } from './reference-codes.ts'

/** 소득세법 시행규칙 별지 제23호서식(4) <개정 2026. 3. 20.> 소득구분코드 표와 경비율 주석, 소득세법 제129조제1항제6호 세율. */
const OTHER_INCOME_FORM: ReadonlyArray<[string, string, number | null, number]> = [
  ['60', '필요경비가 없는 기타소득', 0, 200_000],
  ['62', '그 밖에 필요경비가 있는 기타소득', null, 200_000],
  ['63', '소기업소상공인공제부금 해지 소득', null, 150_000],
  ['64', '서화·골동품 양도소득', 900_000, 200_000],
  ['71', '상금 및 부상', 800_000, 200_000],
  ['72', '광업권 등', 600_000, 200_000],
  ['73', '지역권 등', 600_000, 200_000],
  ['74', '주택입주지체상금', 800_000, 200_000],
  ['75', '원고료 등', 600_000, 200_000],
  ['76', '강연료 등', 600_000, 200_000],
  ['78', '사례금', 0, 200_000],
  ['79', '자문료 등', 600_000, 200_000],
  ['80', '통신판매중개 물품·장소 대여 사용료', 600_000, 200_000],
  ['81', '위약금·배상금', null, 200_000],
]

/** 소득세법 시행규칙 별지 제23호서식(2) <개정 2026. 3. 20.> 업종구분코드 표 40개입니다. */
const BUSINESS_INCOME_FORM: ReadonlyArray<[string, string]> = [
  ['940100', '저술가'],
  ['940200', '화가관련'],
  ['940301', '작곡가'],
  ['940302', '배우'],
  ['940303', '모델'],
  ['940304', '가수'],
  ['940305', '성악가'],
  ['940306', '1인미디어콘텐츠창작자'],
  ['940500', '연예보조'],
  ['940600', '자문·고문'],
  ['940901', '바둑기사'],
  ['940902', '꽃꽂이교사'],
  ['940903', '학원강사'],
  ['940904', '직업운동가'],
  ['940905', '봉사료수취자'],
  ['940906', '보험설계'],
  ['940907', '음료배달'],
  ['940908', '방문판매원'],
  ['940909', '기타인적용역자'],
  ['940910', '다단계판매'],
  ['940911', '기타모집수당'],
  ['940912', '간병인'],
  ['940913', '대리운전'],
  ['940914', '캐디'],
  ['940915', '목욕관리사'],
  ['940916', '행사도우미'],
  ['940917', '심부름용역'],
  ['940918', '퀵서비스'],
  ['940919', '물품운반'],
  ['940920', '학습지방문강사'],
  ['940921', '교육교구방문강사'],
  ['940922', '대여제품방문점검원'],
  ['940923', '대출모집인'],
  ['940924', '신용카드회원모집인'],
  ['940925', '방과후강사'],
  ['940926', '소프트웨어프리랜서'],
  ['940927', '관광통역안내사'],
  ['940928', '어린이통학버스기사'],
  ['940929', '중고자동차판매원'],
  ['851101', '병의원'],
]

describe('reference codes match the statement forms', () => {
  it('pins every other income code, deemed expense rate and tax rate', () => {
    expect(OTHER_INCOME_CODES.map((entry) => [entry.code, entry.name, entry.expenseRatePpm, entry.taxRatePpm])).toEqual(
      OTHER_INCOME_FORM,
    )
    expect(OTHER_INCOME_CODES.every((entry) => entry.verified)).toBe(true)
  })

  it('defaults to 76, a 60% deemed expense code', () => {
    expect(DEFAULT_OTHER_INCOME_CODE).toBe('76')
    expect(OTHER_INCOME_CODES.find((entry) => entry.code === DEFAULT_OTHER_INCOME_CODE)?.expenseRatePpm).toBe(600_000)
  })

  it('pins all 40 business income codes and names', () => {
    expect(BUSINESS_INCOME_CODES.map((entry) => [entry.code, entry.name])).toEqual(BUSINESS_INCOME_FORM)
    expect(BUSINESS_INCOME_CODES.every((entry) => entry.verified)).toBe(true)
  })
})
