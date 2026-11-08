import type { Id } from '../../../shared/ids/ids.types.ts'
import type {
  AccountScope,
  AccountTitleInfo,
  AccountTitleRecord,
  AssignabilityProblem,
  ChildCreationPlan,
} from './account-title.types.ts'

/**
 * 계정과목마다 보고서 줄 이름·그룹 코드·선택 가능 여부를 조상을 따라 풉니다.
 *
 * - 보고서 줄 이름은 2단계 조상(자기 자신 포함)의 이름입니다. 3단계 계정은 상위 계정 줄로 모입니다
 * - 그룹 코드는 1단계 조상의 `code`입니다. 거래대금 그룹은 `trade`입니다
 * - 하위 계정이 없는 2·3단계 계정만 분류에 쓸 수 있습니다
 */
export function indexAccountTitles(rows: ReadonlyArray<AccountTitleRecord>): Map<Id<'accountTitle'>, AccountTitleInfo> {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const 하위가있는계정ID = new Set(rows.flatMap((row) => (row.parentId === null ? [] : [row.parentId])))
  const 계정과목정보 = new Map<Id<'accountTitle'>, AccountTitleInfo>()
  for (const row of rows) {
    let 보고서줄계정 = row
    let 그룹계정 = row
    for (let cursor: AccountTitleRecord | undefined = row; cursor !== undefined;) {
      if (cursor.depth === 2) 보고서줄계정 = cursor
      그룹계정 = cursor
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
    }
    계정과목정보.set(row.id, {
      id: row.id,
      name: row.name,
      depth: row.depth,
      plCategory: row.plCategory,
      cashCategory: row.cashCategory,
      reportName: 보고서줄계정.name,
      groupCode: 그룹계정.code,
      appliesTo: row.appliesTo,
      selectable: row.depth >= 2 && !하위가있는계정ID.has(row.id),
    })
  }
  return 계정과목정보
}

/**
 * 트리를 깊이 우선 순서의 평평한 목록으로 펼칩니다. 형제는 `sortOrder` 순입니다.
 *
 * `appliesTo`나 `search`를 주면 맞는 계정과 그 조상만 남깁니다. 드롭다운이 그룹 제목을 보여야 하기 때문입니다.
 * 걸러 낼 때 자식이 하나도 남지 않은 1단계 그룹은 뺍니다.
 */
export function flattenAccountTitles(
  rows: ReadonlyArray<AccountTitleRecord>,
  filter: { appliesTo?: AccountScope; search?: string } = {},
): AccountTitleRecord[] {
  const 하위계정목록 = new Map<string | null, AccountTitleRecord[]>()
  for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
    하위계정목록.set(row.parentId, [...(하위계정목록.get(row.parentId) ?? []), row])
  }
  const 검색어 = filter.search?.trim().toLowerCase() ?? ''
  const 거르는가 = filter.appliesTo !== undefined || 검색어 !== ''
  const 펼치기 = (row: AccountTitleRecord): AccountTitleRecord[] => {
    const 하위펼침 = (하위계정목록.get(row.id) ?? []).flatMap(펼치기)
    if (하위펼침.length > 0) return [row, ...하위펼침]
    if (!거르는가) return [row]
    const 적용범위맞는가 = filter.appliesTo === undefined || row.appliesTo.includes(filter.appliesTo)
    const 검색어맞는가 = 검색어 === '' || row.name.toLowerCase().includes(검색어)
    return row.depth > 1 && 적용범위맞는가 && 검색어맞는가 ? [row] : []
  }
  return (하위계정목록.get(null) ?? []).flatMap(펼치기)
}

/**
 * 거래를 이 계정과목으로 분류할 수 있는지 검사합니다. 문제가 없으면 `undefined`입니다.
 *
 * 검사 순서는 존재, 적용 범위(매출·매입·입금·출금), 선택 가능(하위 계정 없음)입니다.
 */
export function assignabilityProblem(
  index: ReadonlyMap<Id<'accountTitle'>, AccountTitleInfo>,
  accountTitleId: Id<'accountTitle'>,
  scope: AccountScope,
): AssignabilityProblem | undefined {
  const 계정과목 = index.get(accountTitleId)
  if (계정과목 === undefined) return 'UNKNOWN'
  if (!계정과목.appliesTo.includes(scope)) return 'SCOPE_MISMATCH'
  if (!계정과목.selectable) return 'NOT_SELECTABLE'
  return undefined
}

/**
 * 하위 계정 추가를 계획합니다.
 *
 * - 3단계 아래에는 만들 수 없습니다
 * - 하위 계정이 없던 2단계 계정에 분류된 거래가 있으면 `기타 {상위명}`을 먼저 만들고 거래를 그리로 옮깁니다.
 *   상위 계정은 더 이상 고를 수 없게 되기 때문입니다 (매뉴얼 `08-설정/04-경리-설정.md`)
 * - 같은 상위 아래 같은 이름(자동 생성할 `기타` 포함)은 안 됩니다
 */
export function planChildCreation(input: {
  parent: Pick<AccountTitleRecord, 'depth' | 'name'>
  siblingNames: ReadonlyArray<string>
  classifiedCount: number
  name: string
}): ChildCreationPlan {
  const { parent, siblingNames, classifiedCount, name } = input
  if (parent.depth === 3) return { ok: false, code: 'DEPTH_EXCEEDED' }
  const 자동기타이름 = `기타 ${parent.name}`
  const createAutoEtc = siblingNames.length === 0 && parent.depth === 2 && classifiedCount > 0
  const 쓰인이름 = createAutoEtc ? [...siblingNames, 자동기타이름] : siblingNames
  if (쓰인이름.includes(name)) return { ok: false, code: 'NAME_DUPLICATE' }
  return { ok: true, depth: parent.depth === 1 ? 2 : 3, createAutoEtc, autoEtcName: 자동기타이름 }
}

/** 계정과목을 지울 수 없는 이유입니다. */
export type DeletionProblem = 'SYSTEM_LOCKED' | 'HAS_CHILDREN' | 'MOVE_TARGET_REQUIRED' | 'MOVE_TARGET_INVALID'

/**
 * 회사 계정과목 삭제를 검사합니다. 문제가 없으면 `undefined`입니다.
 *
 * 분류된 거래가 있으면 옮길 계정(`moveToId`)이 있어야 하고, 그 계정은 자기 자신이 아닌 선택 가능한 계정이어야 합니다.
 * 거래는 지우지 않습니다.
 */
export function deletionProblem(input: {
  target: Pick<AccountTitleRecord, 'id' | 'origin'>
  hasChildren: boolean
  classifiedCount: number
  moveToId: Id<'accountTitle'> | undefined
  index: ReadonlyMap<Id<'accountTitle'>, AccountTitleInfo>
}): DeletionProblem | undefined {
  const { target, hasChildren, classifiedCount, moveToId, index } = input
  if (target.origin === 'SYSTEM') return 'SYSTEM_LOCKED'
  if (hasChildren) return 'HAS_CHILDREN'
  if (moveToId === undefined) return classifiedCount > 0 ? 'MOVE_TARGET_REQUIRED' : undefined
  if (moveToId === target.id || index.get(moveToId)?.selectable !== true) return 'MOVE_TARGET_INVALID'
  return undefined
}
