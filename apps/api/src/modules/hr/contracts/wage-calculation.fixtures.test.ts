import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { calculateWage } from './wage-calculation.ts'
import type { WageInput } from './wage-calculation.types.ts'

describeRuleFixture('payroll-contract-wage', (input: { wage: WageInput }) => calculateWage(input.wage))
