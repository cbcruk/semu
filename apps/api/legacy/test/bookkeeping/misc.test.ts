import { beforeEach, describe, expect, it } from 'vitest'
import { toPlainDate } from '../../src/lib/plain-date'
import { signUploadToken, yearEndPeriod } from '../../src/modules/bookkeeping/misc/misc.utils'
import { CORP, createTestContext, JWT_SECRET, type TestContext, USERS } from '../helpers/test-app'

const company = `/api/company/${CORP}`
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

describe('bookkeeping misc routes', () => {
  let ctx: TestContext
  let admin: string

  beforeEach(async () => {
    ctx = await createTestContext()
    admin = await ctx.token(USERS.admin, CORP)
  })

  const get = async (path: string, token = admin): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await ctx.call(token, 'GET', path)
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }
  const put = (uploadUrl: string, bytes: Uint8Array): Promise<Response> =>
    Promise.resolve(ctx.app.request(new URL(uploadUrl).pathname, { method: 'PUT', body: new Uint8Array(bytes) }))

  it('round-trips a signed upload and serves it through the API', async () => {
    const issued = (await get(`${company}/attachments/get-upload-url?file_name=license.png`)).body
    expect(issued['file_path']).toBe(`files/${String(issued['file_id'])}`)
    const uploaded = await put(String(issued['upload_url']), PNG)
    expect(uploaded.status).toBe(201)
    expect(await uploaded.json()).toMatchObject({ file_path: issued['file_path'], mime_type: 'image/png', file_name: 'license.png' })
    expect(ctx.storage.objects.size).toBe(1)

    const download = await ctx.call(admin, 'GET', `${company}/attachments/${String(issued['file_id'])}`)
    expect(download.status).toBe(200)
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG)
    expect((await put(String(issued['upload_url']), PNG)).status).toBe(409)
  })

  it('rejects forged, expired and non-image uploads', async () => {
    const url = String((await get(`${company}/attachments/get-upload-url?file_name=a.png`)).body['upload_url'])
    const forged = url.slice(0, -2) + (url.endsWith('AA') ? 'BB' : 'AA')
    expect((await put(forged, PNG)).status).toBe(401)
    const expired = signUploadToken(JWT_SECRET, { companyId: CORP, userId: USERS.admin, fileId: 'f-old', fileName: 'a.png', expiresAt: 1_000 })
    expect((await put(`http://localhost/api/attachments/upload/${expired}`, PNG)).status).toBe(401)
    const csvUrl = String((await get(`${company}/attachments/get-upload-url?file_name=a.csv`)).body['upload_url'])
    expect((await put(csvUrl, new TextEncoder().encode('a,b\n1,2'))).status).toBe(415)
    expect(ctx.storage.objects.size).toBe(0)
  })

  it('stores a company share and returns it as the recent history', async () => {
    expect((await get(`${company}/share-histories/recent`)).body).toMatchObject({ share_info: null })
    const issued = (await get(`${company}/attachments/get-upload-url?file_name=bankbook.png`)).body
    await put(String(issued['upload_url']), PNG)
    const sent = await ctx.call(admin, 'POST', `${company}/partner/share-company/send`, {
      json: { receivers: ['buyer@example.com'], detail: { address: '서울시 강남구', email: 'ar@demo.kr', phone_number: '0212345678' }, bankbook_image_id: issued['file_id'] },
    })
    expect(sent.status).toBe(201)
    expect((await get(`${company}/share-histories/recent`)).body).toMatchObject({
      receivers: ['buyer@example.com'],
      share_info: { detail: { address: '서울시 강남구', email: 'ar@demo.kr', phone_number: '0212345678' } },
      representative_image: null,
      bankbook_image: { id: issued['file_id'], file_name: 'bankbook.png', file_path: issued['file_path'] },
    })
    const invalid = await ctx.call(admin, 'POST', `${company}/partner/share-company/send`, { json: { receivers: ['nope'] } })
    expect(invalid.status).toBe(422)
  })

  it('refreshes business types from Hometax', async () => {
    expect((await ctx.call(admin, 'GET', `${company}/get-business_types`).then((r) => r.json())) as unknown[]).toEqual([])
    const refreshed = (await ctx.call(admin, 'POST', `${company}/update-business_types`).then((r) => r.json())) as { is_main: boolean; code: string }[]
    expect(refreshed.map((row) => [row.code, row.is_main])).toEqual([
      ['722000', true],
      ['749939', false],
    ])
  })

  it('serves home meta and the year-end settlement window', async () => {
    expect((await get(`${company}/home/ssb/meta`)).body).toMatchObject({ cash_report_as_of: '06:00', pg_delivery_reflect_at: '11:00' })
    expect((await get('/api/bk-works/bk-schedules/current_year_end/')).body).toEqual({ is_period: false, start: '2026-01-15', end: '2026-02-28' })
    expect(yearEndPeriod(toPlainDate('2028-02-29'))).toEqual({ is_period: true, start: '2028-01-15', end: '2028-02-29' })
  })
})
