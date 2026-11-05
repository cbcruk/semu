import { Layer } from 'effect'

/** 세무 신고 건·세무 일정·할 일 카드·예상 부가세 컨텍스트의 핸들러 전체입니다. 저장소와 외부 연동 포트는 호출하는 쪽이 넣습니다. */
export const TaxHttpLive = Layer.empty

/** 세무 신고 건·세무 일정·할 일 카드·예상 부가세 컨텍스트의 저장소·외부 연동을 메모리 구현과 결정적인 가짜로 채웁니다. 로컬 개발과 테스트에 씁니다. */
export const TaxMemoryLive = Layer.empty
