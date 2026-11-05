import type { Id } from '../../shared/ids/ids.types.ts'
import type { GrantRecord } from './grants/grant.ts'
import type { GrantProfile } from './grants/grant-recommendation.types.ts'

/** 데모 회사 ID입니다. Identity & Access 데모 시드(`demo-seed.ts`)의 값과 같습니다. */
const COMPANY = {
  corporation: 'cmp_01JBQ000000000000000000001' as Id<'company'>,
  individual: 'cmp_01JBQ000000000000000000002' as Id<'company'>,
  free: 'cmp_01JBQ000000000000000000003' as Id<'company'>,
  demo: 'cmp_01JBQ000000000000000000004' as Id<'company'>,
}

/** 데모 공고 ID입니다. 테스트가 날짜와 무관하게 결과를 확인하도록 상시·먼 미래·지난 공고로 둡니다. */
export const DEMO_GRANT_IDS = {
  /** 전국, 업종 제한 없음, 상시 모집 */
  nationwide: 'grt_01JBQ000000000000000000001' as Id<'grant'>,
  /** 서울, 정보통신업(J), 2099년 마감 */
  seoulIt: 'grt_01JBQ000000000000000000002' as Id<'grant'>,
  /** 부산, 제조업(C), 상시 모집 */
  busanManufacturing: 'grt_01JBQ000000000000000000003' as Id<'grant'>,
  /** 이미 마감한 공고 */
  closed: 'grt_01JBQ000000000000000000004' as Id<'grant'>,
  /** 아직 신청 전인 공고 */
  upcoming: 'grt_01JBQ000000000000000000005' as Id<'grant'>,
}

const grant = (
  id: Id<'grant'>,
  title: string,
  window: Pick<GrantRecord, 'applyStartOn' | 'applyEndOn' | 'industryCodes' | 'regionCodes'>,
): GrantRecord => ({
  id,
  source: 'BIZINFO',
  title,
  agency: '중소벤처기업부',
  summary: title,
  url: `https://www.bizinfo.go.kr/${id}`,
  ...window,
})

/** 데모 공고입니다. */
export function demoGrants(): GrantRecord[] {
  return [
    grant(DEMO_GRANT_IDS.nationwide, '중소기업 수출 바우처', {
      applyStartOn: '2026-01-01',
      applyEndOn: null,
      industryCodes: [],
      regionCodes: [],
    }),
    grant(DEMO_GRANT_IDS.seoulIt, '서울시 소프트웨어 기업 디지털 전환 지원', {
      applyStartOn: '2026-01-01',
      applyEndOn: '2099-12-31',
      industryCodes: ['J'],
      regionCodes: ['11'],
    }),
    grant(DEMO_GRANT_IDS.busanManufacturing, '부산 제조업 스마트공장 지원', {
      applyStartOn: '2026-01-01',
      applyEndOn: null,
      industryCodes: ['C'],
      regionCodes: ['26'],
    }),
    grant(DEMO_GRANT_IDS.closed, '2025 하반기 고용 장려금', {
      applyStartOn: '2025-07-01',
      applyEndOn: '2025-12-31',
      industryCodes: [],
      regionCodes: [],
    }),
    grant(DEMO_GRANT_IDS.upcoming, '2099 창업 지원', {
      applyStartOn: '2099-01-01',
      applyEndOn: '2099-12-31',
      industryCodes: [],
      regionCodes: [],
    }),
  ]
}

/** 데모 회사의 업종·지역입니다. 무료 고객(카페)은 업종이 불명확한 회사로 둡니다. */
export function demoGrantProfiles(): Array<readonly [Id<'company'>, GrantProfile]> {
  return [
    [COMPANY.corporation, { industryCodes: ['J62'], regionCode: '11680' }],
    [COMPANY.individual, { industryCodes: ['C10'], regionCode: '26' }],
    [COMPANY.free, { industryCodes: [], regionCode: '11' }],
    [COMPANY.demo, { industryCodes: ['J62'], regionCode: '11' }],
  ]
}
