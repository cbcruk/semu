import { Schema } from 'effect'
import { UserId } from '../accounts/user.ts'
import { BusinessType, CompanyId, PlanSchema } from '../companies/company.ts'

/** 담당 회사의 세무 일감 요약입니다. 개수는 Tax가 셉니다. */
export const AgencyCompanyWorkload = Schema.Struct({
  /** 끝나지 않은 신고 건 수입니다. 세무 기장(`TAXATION`) 회사만 셉니다. */
  openFilingCount: Schema.Int,
  /** 그중 기한이 지난 신고 건 수입니다. */
  overdueFilingCount: Schema.Int,
  /** 진행중인 할 일 카드(고객이 할 일) 수입니다. */
  openActionCardCount: Schema.Int,
  /** 끝나지 않은 신고 건의 가장 가까운 기한입니다. */
  nearestDueDate: Schema.NullOr(Schema.String),
})

/**
 * 대리인 작업 큐의 담당 회사 한 줄입니다. 이 회사의 리소스를 다루려면 `id`로 `POST /auth/sessions:switch-company`를 부릅니다.
 */
export const AgencyCompany = Schema.Struct({
  id: CompanyId,
  name: Schema.String,
  businessType: BusinessType,
  plans: Schema.Array(PlanSchema),
  /** 이 회사에 배정된 담당자입니다. 팀장은 어느 팀원의 회사인지 봅니다. */
  assigneeIds: Schema.Array(UserId),
  workload: AgencyCompanyWorkload,
})

export type AgencyCompany = typeof AgencyCompany.Type
