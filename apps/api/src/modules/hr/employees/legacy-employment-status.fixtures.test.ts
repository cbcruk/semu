import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import type { InsuranceFilingKind } from '../insurance-filings/insurance-filing.types.ts'
import type { EmployeeStatus } from './employee-status.types.ts'
import { legacyEmploymentStatus } from './legacy-employment-status.ts'

describeRuleFixture(
  'legacy-employment-status',
  (input: { hasRegistrationNumber: boolean; status: EmployeeStatus; pendingFilings: InsuranceFilingKind[] }) =>
    legacyEmploymentStatus(input, new Set(input.pendingFilings)),
)
