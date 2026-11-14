import type { Grant, GrantRecord } from './grant.ts'

/** 원천이 준 공고 하나입니다. `source`와 `externalId`(원천의 공고 번호)가 같으면 같은 공고입니다. */
export interface GrantNotice extends Omit<Grant, 'id'> {
  externalId: string
}

/** {@link mergeGrantFeed}의 결과입니다. 저장할 공고만 담습니다. */
export interface GrantFeedMerge {
  created: GrantRecord[]
  updated: GrantRecord[]
}

/**
 * 원천 공고를 저장된 공고에 합칩니다. 같은 `source`·`externalId`의 공고가 있으면 내용이 바뀌었을 때만 고치고(ID는 그대로),
 * 없으면 `newId`로 새로 만듭니다. 원천에서 빠진 공고는 지우지 않습니다. 신청 마감일이 지나면 조회에서 빠집니다.
 *
 * 같은 원천 목록으로 다시 돌려도 바꿀 것이 없습니다.
 */
export function mergeGrantFeed(
  existing: ReadonlyArray<GrantRecord>,
  notices: ReadonlyArray<GrantNotice>,
  newId: () => GrantRecord['id'],
): GrantFeedMerge {
  const 저장된공고 = new Map(existing.map((grant) => [keyOf(grant), grant]))
  const created: GrantRecord[] = []
  const updated: GrantRecord[] = []
  const 본공고 = new Set<string>()
  for (const notice of notices) {
    const key = keyOf(notice)
    if (본공고.has(key)) continue
    본공고.add(key)
    const found = 저장된공고.get(key)
    if (found === undefined) {
      created.push({ ...notice, id: newId() })
      continue
    }
    const next: GrantRecord = { ...notice, id: found.id }
    if (!sameContent(found, next)) updated.push(next)
  }
  return { created, updated }
}

function keyOf(grant: { source: string; externalId?: string | undefined; id?: string }): string {
  return `${grant.source}:${grant.externalId ?? grant.id}`
}

function sameContent(a: GrantRecord, b: GrantRecord): boolean {
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b))
}

function normalized(grant: GrantRecord) {
  return {
    source: grant.source,
    externalId: grant.externalId,
    title: grant.title,
    agency: grant.agency,
    summary: grant.summary,
    url: grant.url,
    industryCodes: grant.industryCodes,
    regionCodes: grant.regionCodes,
    applyStartOn: grant.applyStartOn,
    applyEndOn: grant.applyEndOn,
  }
}
