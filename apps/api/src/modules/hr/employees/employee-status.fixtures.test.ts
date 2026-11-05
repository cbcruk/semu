import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { deriveEmployeeStatus } from './employee-status.ts'
import type { EmployeeDates } from './employee-status.types.ts'

describeRuleFixture('employee-status', (input: { dates: EmployeeDates; asOf: string }) =>
  deriveEmployeeStatus(input.dates, input.asOf),
)
