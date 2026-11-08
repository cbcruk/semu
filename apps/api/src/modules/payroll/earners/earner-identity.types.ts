/**
 * 소득자 신원번호의 종류입니다.
 *
 * - `RESIDENT`: 주민등록번호(7번째 자리 1·2·3·4, 1800년대 출생 9·0)
 * - `ALIEN`: 외국인등록번호(7번째 자리 5·6·7·8)
 * - `PASSPORT`: 여권번호(등록번호가 없는 외국인)
 */
export type EarnerIdentityType = 'RESIDENT' | 'ALIEN' | 'PASSPORT'
