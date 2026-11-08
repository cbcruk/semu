import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'

/**
 * 지급월의 원천세 신고가 끝났는지 묻는 포트입니다. Tax가 구현합니다.
 *
 * 신고가 `FILED` 이후이면 그 지급월의 급여대장은 금액이 바뀌는 커맨드(재계산·되돌리기·반려·마감 해제·추가 대장·
 * 지급일 이동)를 409 `WITHHOLDING_FILED`로 거부합니다.
 * 지급일이 그 달인 퇴직금 정산도 완료·다시 열기와 그 달로 들이는 지급일 변경을 같은 409로 거부합니다(빠져나가는 계산됨 정산은 받음).
 */
export class WithholdingFilingLock extends Context.Service<
  WithholdingFilingLock,
  {
    /** `paymentMonth`(`YYYY-MM`)에 지급한 소득의 원천세 신고가 이미 제출됐는지입니다. */
    isFiled(companyId: Id<'company'>, paymentMonth: string): Effect.Effect<boolean>
  }
>()('semu/payroll/WithholdingFilingLock') {
  /** 신고된 지급월 목록을 고정으로 쓰는 가짜입니다. Tax 구현이 연결되기 전 로컬 개발과 테스트에 씁니다. */
  static readonly layerMemory = (filed: ReadonlyArray<{ companyId: Id<'company'>; paymentMonth: string }> = []) =>
    Layer.succeed(
      WithholdingFilingLock,
      WithholdingFilingLock.of({
        isFiled: (companyId, paymentMonth) =>
          Effect.succeed(filed.some((entry) => entry.companyId === companyId && entry.paymentMonth === paymentMonth)),
      }),
    )
}
