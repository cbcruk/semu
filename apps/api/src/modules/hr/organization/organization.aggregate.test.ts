import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import {
  decideUnitCreation,
  decideUnitRemoval,
  decideUnitRename,
  decideUnitReorder,
  unitsMarkedAssigned,
} from './organization.aggregate.ts'
import type { OrganizationUnitRecord } from './organization.ts'

const COMPANY = 'cmp_01JBQ000000000000000000001' as Id<'company'>

function unit(n: number, name: string, overrides: Partial<OrganizationUnitRecord> = {}): OrganizationUnitRecord {
  return {
    id: `dep_01JBQ00000000000000000000${n}` as Id<'department'>,
    companyId: COMPANY,
    kind: 'DEPARTMENT',
    name,
    order: n - 1,
    everAssigned: false,
    version: 1,
    ...overrides,
  }
}

const SIBLINGS = [unit(1, '경영지원'), unit(2, '영업')]

describe('조직 단위 생성 판정', () => {
  it('앞뒤 공백을 지운 이름으로 맨 뒤에 만듭니다', () => {
    const result = decideUnitCreation(
      { id: 'dep_new' as Id<'department'>, companyId: COMPANY, kind: 'DEPARTMENT', name: ' 개발 ' },
      SIBLINGS,
    )
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.unit).toMatchObject({ name: '개발', order: 2, everAssigned: false, version: 1 })
  })

  it('같은 종류 안에서 공백만 다른 이름도 겹친다고 봅니다', () => {
    const result = decideUnitCreation(
      { id: 'dep_new' as Id<'department'>, companyId: COMPANY, kind: 'DEPARTMENT', name: '영업 ' },
      SIBLINGS,
    )
    expect(Result.isFailure(result) && result.failure._tag).toBe('OrganizationNameTaken')
  })
})

describe('조직 단위 이름 변경 판정', () => {
  it('자기 이름은 겹친다고 보지 않고 버전을 올립니다', () => {
    const result = decideUnitRename(SIBLINGS[1]!, '영업', SIBLINGS)
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.unit).toMatchObject({ name: '영업', version: 2 })
  })

  it('다른 단위의 이름이면 거부합니다', () => {
    const result = decideUnitRename(SIBLINGS[1]!, '경영지원', SIBLINGS)
    expect(Result.isFailure(result)).toBe(true)
  })
})

describe('조직 단위 삭제 판정', () => {
  it('지금 배치된 직원이 없어도 한 번 배치된 적이 있으면 거부합니다', () => {
    const result = decideUnitRemoval(unit(1, '경영지원', { everAssigned: true }), 0)
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: 'OrganizationUnitInUse',
      kind: 'DEPARTMENT',
    })
  })

  it('배치된 적이 없으면 지웁니다', () => {
    expect(Result.isSuccess(decideUnitRemoval(unit(1, '경영지원'), 0))).toBe(true)
  })
})

describe('조직 단위 순서 변경 판정', () => {
  it('순서가 바뀐 단위만 버전을 올려 돌려줍니다', () => {
    const third = unit(3, '개발')
    const result = decideUnitReorder([...SIBLINGS, third], [SIBLINGS[1]!.id, SIBLINGS[0]!.id, third.id])
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.units.map((changed) => [changed.name, changed.order, changed.version])).toEqual([
      ['경영지원', 1, 2],
      ['영업', 0, 2],
    ])
  })

  it('빠지거나 겹치거나 모르는 ID가 있으면 거부합니다', () => {
    const [first, second] = SIBLINGS.map((sibling) => sibling.id)
    for (const ids of [[first!], [first!, first!], [first!, 'dep_unknown'], [first!, second!, 'dep_unknown']]) {
      expect(Result.isFailure(decideUnitReorder(SIBLINGS, ids))).toBe(true)
    }
  })
})

describe('직원 배치 표시', () => {
  it('직원이 가리키는 단위 중 표시가 꺼진 것만 켜서 돌려줍니다', () => {
    const position = {
      ...unit(3, '팀장'),
      id: 'pos_01JBQ000000000000000000001' as Id<'position'>,
      kind: 'POSITION' as const,
    }
    const marked = unitsMarkedAssigned(
      { departmentId: SIBLINGS[0]!.id as Id<'department'>, positionId: position.id as Id<'position'> },
      [...SIBLINGS, { ...position, everAssigned: true }],
    )
    expect(marked).toEqual([{ ...SIBLINGS[0], everAssigned: true }])
  })
})
