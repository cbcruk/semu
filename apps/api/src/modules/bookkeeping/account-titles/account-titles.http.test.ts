import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestApp } from '../common/test-app.ts'
import { testApp } from '../common/test-app.ts'
import { systemAccountTitleIdOf } from './system-account-titles.ts'

type Node = { id: string }
type Created = { accountTitle: Node; autoCreatedEtc: Node }
type Json = Created

let app: TestApp
beforeEach(() => {
  app = testApp()
})
afterEach(() => app.dispose())

describe('계정과목 조회 GET /v1/account-titles', () => {
  it('적용 범위로 거르면 맞는 계정과 그 그룹 제목을 깊이 우선 순서로 돌려줍니다', async () => {
    const response = await app.send('GET', '/v1/account-titles?appliesTo=DEPOSIT&search=이자')

    expect(response.status).toBe(200)
    const { items } = (await response.json()) as { items: Array<{ name: string; depth: number; selectable: boolean }> }
    expect(items.map((row) => [row.name, row.depth, row.selectable])).toEqual([
      ['영업외수익', 1, false],
      ['이자수익', 2, true],
    ])
  })
})

describe('하위 계정과목 추가 POST /v1/account-titles', () => {
  it('분류된 거래가 있는 계정에 첫 하위 계정을 만들면 자동 기타 계정을 만들어 거래를 옮깁니다', async () => {
    const response = await app.send('POST', '/v1/account-titles', {
      body: { parentId: systemAccountTitleIdOf('sga.welfare'), name: '식대' },
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as Json
    expect(body).toMatchObject({
      accountTitle: { name: '식대', depth: 3, origin: 'COMPANY', selectable: true },
      autoCreatedEtc: { name: '기타 복리후생비', depth: 3, origin: 'AUTO_ETC', selectable: true },
      movedCount: 2,
    })
    const evidence = await app.send('GET', '/v1/evidence?side=PURCHASE&source=CARD')
    const rows = ((await evidence.json()) as { items: Array<{ classification: { accountTitleId: string } }> }).items
    expect(rows.every((row) => row.classification.accountTitleId === body.autoCreatedEtc.id)).toBe(true)
  })

  it('4단계 계정과목은 만들 수 없습니다', async () => {
    const response = await app.send('POST', '/v1/account-titles', {
      body: { parentId: systemAccountTitleIdOf('trade.sales_in.partner'), name: '하위' },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'ACCOUNT_TITLE_DEPTH_EXCEEDED' })
  })

  it('같은 상위 계정 아래 같은 이름은 만들 수 없습니다', async () => {
    const response = await app.send('POST', '/v1/account-titles', {
      body: { parentId: systemAccountTitleIdOf('trade.sales_in'), name: '카드 매출 대금 입금' },
    })

    expect(response.status).toBe(409)
  })
})

describe('계정과목 수정·삭제 PATCH·DELETE /v1/account-titles/{id}', () => {
  it('기본 계정과목은 고치거나 지울 수 없습니다', async () => {
    const id = systemAccountTitleIdOf('sga.rent')
    const renamed = await app.send('PATCH', `/v1/account-titles/${id}`, { body: { name: '월세' } })
    const deleted = await app.send('DELETE', `/v1/account-titles/${id}`)

    expect(renamed.status).toBe(409)
    expect(deleted.status).toBe(409)
    expect(await deleted.json()).toMatchObject({ code: 'ACCOUNT_TITLE_SYSTEM_LOCKED' })
  })

  it('분류된 거래가 있으면 옮길 계정이 있어야 지우고, 거래를 그 계정으로 옮깁니다', async () => {
    const created = await app.send('POST', '/v1/account-titles', {
      body: { parentId: systemAccountTitleIdOf('sga.welfare'), name: '식대' },
    })
    const { autoCreatedEtc, accountTitle } = (await created.json()) as Created

    const refused = await app.send('DELETE', `/v1/account-titles/${autoCreatedEtc.id}`)
    const moved = await app.send('DELETE', `/v1/account-titles/${autoCreatedEtc.id}?moveToId=${accountTitle.id}`)

    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ reason: 'MOVE_TARGET_REQUIRED', classifiedCount: 2 })
    expect(await moved.json()).toEqual({ movedCount: 2 })
  })
})
