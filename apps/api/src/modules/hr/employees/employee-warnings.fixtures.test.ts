import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { employeeWarnings } from './employee-warnings.ts'
import type { EmployeeWarningInput } from './employee-warnings.types.ts'

describeRuleFixture(
  'contract-expiry-warning',
  (input: { employee: EmployeeWarningInput; asOf: string; warningDays: number }) =>
    employeeWarnings(input.employee, input.asOf, input.warningDays),
)
