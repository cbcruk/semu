import { Layer } from 'effect'

/** 급여 계산 엔진·기준표·급여 설정·급여대장·명세서·퇴직금 컨텍스트의 핸들러 전체입니다. 저장소와 외부 연동 포트는 호출하는 쪽이 넣습니다. */
export const PayrollHttpLive = Layer.empty

/** 급여 계산 엔진·기준표·급여 설정·급여대장·명세서·퇴직금 컨텍스트의 저장소·외부 연동을 메모리 구현과 결정적인 가짜로 채웁니다. 로컬 개발과 테스트에 씁니다. */
export const PayrollMemoryLive = Layer.empty
