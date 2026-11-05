/**
 * AI 비서·지원사업 추천 컨텍스트가 다른 컨텍스트와 `app.ts`에 내보내는 것입니다.
 *
 * - `AssistantModel`: 언어 모델 포트. 운영에서는 LLM 어댑터 Layer로 바꿉니다
 * - `CompanyGrantProfiles`: 회사 업종·지역 포트. Identity & Access(지역)와 홈택스 업종 코드 보유처가 구현합니다
 * - `GrantRepository`: 공고 수집 작업(GrantFeed)이 공고를 쓰는 저장소
 */
export { AssistantModel } from './conversations/assistant-model.ts'
export type { AssistantReply, AssistantTurn } from './conversations/assistant-model.ts'
export { CompanyGrantProfiles } from './grants/grant-profiles.ts'
export type { GrantProfile } from './grants/grant-recommendation.types.ts'
export { GrantRepository } from './grants/grant-repository.ts'
export type { AssistantTool, ToolMode } from './tools/assistant-tool.types.ts'
