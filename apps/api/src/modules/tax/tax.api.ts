import { HttpApi } from 'effect/http-api'
import { ActionCardsApi } from './action-cards/action-cards.api.ts'
import { AgencyQueueApi } from './agency/agency-queue.api.ts'
import { TaxCalendarApi } from './calendar/tax-calendar.api.ts'
import { FilingsApi } from './filings/filings.api.ts'
import { TaxSettingsApi } from './settings/tax-settings.api.ts'
import { VatEstimatesApi } from './vat-estimates/vat-estimates.api.ts'

/**
 * 세무 신고 건·세무 일정·할 일 카드·예상 부가세·세무 설정 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 그룹을 추가할 때 인증이 필요한 그룹은 `.middleware(Authentication)`을 붙입니다. 대리인 작업 큐(`/agency/*`)는
 * `.middleware(AgencyAuthentication)`을 붙입니다.
 */
export const TaxApi = HttpApi.make('tax')
  .add(FilingsApi)
  .add(TaxCalendarApi)
  .add(ActionCardsApi)
  .add(VatEstimatesApi)
  .add(AgencyQueueApi)
  .add(TaxSettingsApi)
