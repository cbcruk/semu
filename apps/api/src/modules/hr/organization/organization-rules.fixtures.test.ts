import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { isOrganizationNameTaken, isOrganizationUnitInUse, type OrganizationUnitUsage } from './organization-rules.ts'

type Input =
  | { check: 'inUse'; unit: OrganizationUnitUsage }
  | { check: 'nameTaken'; name: string; existing: { id: string; name: string }[]; selfId?: string }

describeRuleFixture('organization-unit-in-use', (input: Input) =>
  input.check === 'inUse'
    ? isOrganizationUnitInUse(input.unit)
    : isOrganizationNameTaken(input.name, input.existing, input.selfId),
)
