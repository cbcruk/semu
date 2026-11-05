import { Layer } from 'effect'
import { demoGrantProfiles, demoGrants } from './assistant-seed.ts'
import { AssistantModel } from './conversations/assistant-model.ts'
import { ConversationRepository } from './conversations/conversation-repository.ts'
import { ConversationsHttpLive } from './conversations/conversations.http.ts'
import { Conversations } from './conversations/conversations.ts'
import { CompanyGrantProfiles } from './grants/grant-profiles.ts'
import { GrantRepository } from './grants/grant-repository.ts'
import { GrantsHttpLive } from './grants/grants.http.ts'
import { Grants } from './grants/grants.ts'

/**
 * AI 비서·지원사업 추천 컨텍스트의 핸들러 전체입니다. 저장소와 외부 연동 포트는 호출하는 쪽이 넣습니다.
 *
 * 필요한 것: `ConversationRepository`, `GrantRepository`, `AssistantModel`(언어 모델), `CompanyGrantProfiles`(회사 업종·지역).
 */
export const AssistantHttpLive = Layer.mergeAll(ConversationsHttpLive, GrantsHttpLive).pipe(
  Layer.provide(Layer.mergeAll(Conversations.layer, Grants.layer)),
)

/**
 * AI 비서·지원사업 추천 컨텍스트의 저장소·외부 연동을 메모리 구현과 결정적인 가짜로 채웁니다. 로컬 개발과 테스트에 씁니다.
 *
 * 언어 모델은 낱말로 도구를 고르는 가짜이고, 회사 업종·지역은 데모 회사 값으로 채웁니다.
 */
export const AssistantMemoryLive = Layer.mergeAll(
  ConversationRepository.layerMemory(),
  GrantRepository.layerMemory(demoGrants()),
  AssistantModel.layerFake,
  CompanyGrantProfiles.layerMemory(demoGrantProfiles()),
)
