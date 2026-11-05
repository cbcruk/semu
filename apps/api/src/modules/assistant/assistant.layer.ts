import { Layer } from 'effect'
import { TableFactory } from '../../shared/persistence/record-table.ts'
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
 * AI 비서·지원사업 추천 컨텍스트의 저장소와 외부 연동입니다. 저장소 표는 `TableFactory`(메모리 또는 SQLite)에 둡니다.
 *
 * 언어 모델은 낱말로 도구를 고르는 가짜이고, 회사 업종·지역은 데모 회사 값으로 채웁니다.
 */
export const AssistantStoreLive = Layer.mergeAll(
  ConversationRepository.layer(),
  GrantRepository.layer(demoGrants()),
  AssistantModel.layerFake,
  CompanyGrantProfiles.layerMemory(demoGrantProfiles()),
)

/** {@link AssistantStoreLive}를 메모리 표로 채웁니다. 로컬 개발과 테스트에 씁니다. */
export const AssistantMemoryLive = AssistantStoreLive.pipe(Layer.provide(TableFactory.layerMemory))
