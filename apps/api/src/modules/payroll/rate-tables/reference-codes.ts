import type { ReferenceCode } from './reference-codes.types.ts'

const FROM = '2024-01'

// 코드 출처(아래에서 "서식"): 소득세법 시행규칙 별지 제23호서식(2) "거주자의 사업소득 지급명세서" <개정 2026. 3. 20.>
// 작성방법 업종구분코드 표와 별지 제23호서식(4) "거주자의 기타소득 지급명세서" <개정 2026. 3. 20.> 작성방법 소득구분코드 표.
// 두 서식은 별지 제23호서식 묶음 파일(첫 서식(1)은 <개정 2026. 5. 22.>) 하나에 들어 있습니다.
// https://www.law.go.kr/flDownload.do?gubun=&flSeq=164443773&bylClsCd=110202

function other(code: string, name: string, expenseRatePpm: number | null, taxRatePpm = 200_000): ReferenceCode {
  return {
    code,
    name,
    expenseRatePpm,
    taxRatePpm,
    detailType: null,
    effectiveFrom: FROM,
    effectiveTo: null,
    verified: true,
  }
}

function business(code: string, name: string, detailType: 'ARTIST' | 'SPECIAL' | null = null): ReferenceCode {
  return {
    code,
    name,
    expenseRatePpm: null,
    taxRatePpm: null,
    detailType,
    effectiveFrom: FROM,
    effectiveTo: null,
    verified: true,
  }
}

/**
 * 기타소득 지급사유 코드입니다. 코드와 이름은 서식의 소득구분코드 표, 의제 필요경비율은 같은 표의 주석입니다
 * (72·73·75·76·79·80은 2019. 1. 1. 이후 100분의 60, 71·74는 100분의 80, 64는 1억원 이하분 100분의 90).
 * 세율은 소득세법 제129조제1항제6호입니다(라목 20%, 나목: 제21조제1항제18호 공제부금 해지일시금 15%).
 * `expenseRatePpm`이 `null`이면 실제 필요경비만 받습니다.
 *
 * 엔진이 다루지 못하는 코드는 넣지 않았습니다: 61(원천징수하지 않음), 65(직무발명 비과세 한도 초과분),
 * 68(비과세), 69(분리과세), 77(종교인소득 구간별 경비). 64의 1억원 초과분 80%와 보유 10년 이상 90%도 나누지 않습니다.
 * 연금계좌 연금외수령(15%)은 기타소득 지급명세서가 아니라 별지 제24호서식(6)에 적으므로 여기 없습니다.
 */
export const OTHER_INCOME_CODES: readonly ReferenceCode[] = [
  other('60', '필요경비가 없는 기타소득', 0),
  other('62', '그 밖에 필요경비가 있는 기타소득', null),
  other('63', '소기업소상공인공제부금 해지 소득', null, 150_000),
  other('64', '서화·골동품 양도소득', 900_000),
  other('71', '상금 및 부상', 800_000),
  other('72', '광업권 등', 600_000),
  other('73', '지역권 등', 600_000),
  other('74', '주택입주지체상금', 800_000),
  other('75', '원고료 등', 600_000),
  other('76', '강연료 등', 600_000),
  other('78', '사례금', 0),
  other('79', '자문료 등', 600_000),
  other('80', '통신판매중개 물품·장소 대여 사용료', 600_000),
  other('81', '위약금·배상금', null),
]

/**
 * 사업소득 업종코드입니다. 코드와 이름은 서식의 업종구분코드 표 40개입니다.
 *
 * `detailType`(예술인·노무제공자 구분)은 서식에 없고 현행 화면의 구분을 옮긴 화면 힌트입니다(학습용 가정). 새로 넣은
 * 코드는 원문으로 확인하지 못해 `null`로 둡니다. 고용보험 대상 여부는 업종이 아니라 계약으로 정해지므로 계산은
 * `detailType`을 보지 않고 행의 `employmentInsuranceApplicable` 표시만 봅니다.
 */
export const BUSINESS_INCOME_CODES: readonly ReferenceCode[] = [
  business('940100', '저술가', 'ARTIST'),
  business('940200', '화가관련', 'ARTIST'),
  business('940301', '작곡가', 'ARTIST'),
  business('940302', '배우', 'ARTIST'),
  business('940303', '모델', 'ARTIST'),
  business('940304', '가수', 'ARTIST'),
  business('940305', '성악가', 'ARTIST'),
  business('940306', '1인미디어콘텐츠창작자'),
  business('940500', '연예보조', 'ARTIST'),
  business('940600', '자문·고문'),
  business('940901', '바둑기사'),
  business('940902', '꽃꽂이교사'),
  business('940903', '학원강사'),
  business('940904', '직업운동가'),
  business('940905', '봉사료수취자'),
  business('940906', '보험설계', 'SPECIAL'),
  business('940907', '음료배달'),
  business('940908', '방문판매원', 'SPECIAL'),
  business('940909', '기타인적용역자'),
  business('940910', '다단계판매'),
  business('940911', '기타모집수당'),
  business('940912', '간병인'),
  business('940913', '대리운전', 'SPECIAL'),
  business('940914', '캐디', 'SPECIAL'),
  business('940915', '목욕관리사'),
  business('940916', '행사도우미'),
  business('940917', '심부름용역'),
  business('940918', '퀵서비스', 'SPECIAL'),
  business('940919', '물품운반', 'SPECIAL'),
  business('940920', '학습지방문강사', 'SPECIAL'),
  business('940921', '교육교구방문강사'),
  business('940922', '대여제품방문점검원'),
  business('940923', '대출모집인'),
  business('940924', '신용카드회원모집인'),
  business('940925', '방과후강사'),
  business('940926', '소프트웨어프리랜서', 'SPECIAL'),
  business('940927', '관광통역안내사'),
  business('940928', '어린이통학버스기사'),
  business('940929', '중고자동차판매원'),
  business('851101', '병의원'),
]

/** 서화·골동품 양도소득 지급사유 코드입니다. */
export const ARTWORK_CODE = '64'

/** 서화·골동품 의제 경비 90%를 그대로 쓸 수 있는 양도가액 상한(1억원)입니다. 넘는 분은 서식상 80%(보유 10년 이상 90%)입니다. */
export const ARTWORK_FULL_RATE_LIMIT = 100_000_000

/**
 * 기본 기타소득 지급사유입니다. 현행 기본값은 "필요경비 있는 기타소득, 60%"를 `60`으로 불렀지만 서식의 60은
 * 필요경비가 없는 기타소득입니다. 같은 60% 의제 경비를 쓰는 `76`(강연료 등)을 기본으로 둡니다.
 */
export const DEFAULT_OTHER_INCOME_CODE = '76'

/** 그 달에 쓸 수 있는 코드만 남깁니다. */
export function codesInForce(codes: readonly ReferenceCode[], month: string): ReferenceCode[] {
  return codes.filter((code) => code.effectiveFrom <= month && (code.effectiveTo === null || code.effectiveTo >= month))
}

/** 그 달에 쓸 수 있는 기타소득 지급사유를 찾습니다. */
export function findOtherIncomeCode(code: string, month: string): ReferenceCode | undefined {
  return codesInForce(OTHER_INCOME_CODES, month).find((entry) => entry.code === code)
}
