import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll } from '../../db/query'
import type { SeedContext } from '../../db/seed.types'
import { DEMO_ACCOUNT } from './accounts/demo-account'
import { hashPassword } from './auth/password.utils'
import { addSeconds, sha256Hex } from './platform.utils'

/** Fixed credentials and tokens of the platform fixtures, shared by tests and local development. */
export const PLATFORM_SEED = {
  password: 'alfred1234',
  demo: DEMO_ACCOUNT,
  signupInvitationToken: 'signup-invite-demo',
  chatChannelToken: 'chat-channel-demo',
  partner: { id: 'partner-demo', apiKey: 'partner-demo-key', jwtSecret: 'partner-demo-secret-partner-demo-secret' },
  overtax: { id: 'overtax', apiKey: 'overtax-demo-key', jwtSecret: 'overtax-demo-secret-overtax-demo-secret' },
  hometaxDelegationId: 'htd-corp',
} as const

const TERMS: readonly [code: string, purpose: string, title: string, required: 0 | 1, audience: 'all' | 'taxation'][] = [
  ['service', 'signup', '서비스 이용약관', 1, 'all'],
  ['privacy', 'signup', '개인정보 수집·이용 동의', 1, 'all'],
  ['marketing', 'signup', '마케팅 정보 수신 동의', 0, 'all'],
  ['tax_service', 'tax', '세무 서비스 이용약관', 1, 'taxation'],
  ['consult_privacy', 'consulting', '상담 개인정보 수집·이용 동의', 1, 'all'],
  ['consult_third_party', 'consulting', '상담 개인정보 제3자 제공 동의', 1, 'all'],
  ['bookkeeping_contract', 'contract', '기장 대리 계약 약관', 1, 'all'],
  ['cms_withdrawal', 'cms', 'CMS 자동이체 출금 동의', 1, 'all'],
]

const ROLE_TEMPLATES: readonly [id: string, name: string, codes: readonly string[]][] = [
  ['tpl-tax', '세무 담당', ['tax_surtax', 'tax_withholding', 'tax_corporation', 'estimated_vat']],
  ['tpl-finance', '재무 담당', ['integrate_transaction', 'integrate_tax', 'cert_management']],
  ['tpl-hr', '인사 담당', ['employee_management']],
]

let sharedPasswordHash: string | undefined
let demoPasswordHash: string | undefined

/**
 * Inserts the platform domain's demo fixtures on top of the shared companies and users.
 *
 * Every seeded user signs in with {@linkcode PLATFORM_SEED.password} except the
 * demo user, whose password is {@linkcode DEMO_ACCOUNT}'s. Company admins are
 * system admins; taxation companies hold an active tax subscription so the
 * plan cache and billing agree.
 */
export function seedPlatformDemo(db: DatabaseSync, context: SeedContext & { taxTermsVersion?: string }): void {
  const { now, cipher } = context
  sharedPasswordHash ??= hashPassword(PLATFORM_SEED.password)
  demoPasswordHash ??= hashPassword(DEMO_ACCOUNT.password)

  for (const user of queryAll<{ id: string; user_type: number }>(db, 'SELECT id, user_type FROM users')) {
    execute(db, 'UPDATE users SET password_hash = ?, name = ?, created_at = ? WHERE id = ?', [
      user.user_type === 99 ? demoPasswordHash : sharedPasswordHash,
      user.id.replace(/^u-/, ''),
      now,
      user.id,
    ])
  }
  execute(db, "UPDATE memberships SET is_system_admin = CASE WHEN role = 'admin' THEN 1 ELSE 0 END, joined_at = ?", [now])

  execute(db, "UPDATE companies SET agency_id = 'agency-hq', agency_type = 'hq', region_code = '11', phone = '0212345678' WHERE tax_plan = 'taxation'")
  for (const company of queryAll<{ id: string; name: string }>(db, "SELECT id, name FROM companies WHERE tax_plan = 'taxation'")) {
    execute(db, "INSERT INTO company_representatives (company_id, id, role, name, phone, sort_order) VALUES (?, 'rep-1', 'boss', ?, '01012345678', 0)", [
      company.id,
      `${company.name} 대표`,
    ])
    execute(
      db,
      `INSERT INTO company_subscriptions (id, company_id, code, status, started_on, ended_on, monthly_fee, created_at, updated_at)
       VALUES (?, ?, 'tax', 'active', '2026-01-01', NULL, 110000, ?, ?)`,
      [`sub-${company.id}-tax`, company.id, now, now],
    )
  }

  const taxVersion = context.taxTermsVersion ?? '2026-01'
  for (const [code, purpose, title, required, audience] of TERMS) {
    execute(
      db,
      `INSERT INTO terms (code, purpose_code, title, content_url, version, is_required, audience, effective_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01', ?)`,
      [code, purpose, title, `/static/terms/${code}.html`, purpose === 'tax' ? taxVersion : '2026-01', required, audience, now],
    )
  }
  const signupTerms = queryAll<{ id: number; code: string; version: string }>(db, "SELECT id, code, version FROM terms WHERE purpose_code = 'signup'")
  const taxTerm = queryAll<{ id: number; code: string; version: string }>(db, "SELECT id, code, version FROM terms WHERE purpose_code = 'tax'")
  const agreedTax = new Set(queryAll<{ user_id: string }>(db, "SELECT user_id FROM term_agreements WHERE term_type = 'tax'").map((row) => row.user_id))
  for (const user of queryAll<{ id: string }>(db, 'SELECT id FROM users')) {
    for (const term of [...signupTerms, ...(agreedTax.has(user.id) ? taxTerm : [])]) {
      execute(db, 'INSERT INTO user_term_agreements (user_id, term_id, term_code, version, is_agreed, agreed_at) VALUES (?, ?, ?, ?, ?, ?)', [
        user.id,
        term.id,
        term.code,
        term.version,
        term.code === 'marketing' ? 0 : 1,
        now,
      ])
    }
  }

  ROLE_TEMPLATES.forEach(([id, name, codes], index) => {
    execute(db, 'INSERT INTO perm_role_templates (id, name, menu_codes, sort_order) VALUES (?, ?, ?, ?)', [id, name, JSON.stringify(codes), index])
  })

  execute(
    db,
    `INSERT INTO signup_invitations (id, token_hash, email, company_name, business_number, business_type, agency_id, status, created_at, expires_at)
     VALUES ('si-demo', ?, 'invitee@example.com', '초대상사', '1238145600', 'individual', 'agency-hq', 'issued', ?, ?)`,
    [sha256Hex(PLATFORM_SEED.signupInvitationToken), now, addSeconds(now, 30 * 86_400)],
  )
  execute(db, "INSERT INTO chat_channel_tokens (token_hash, messenger_type, channel_name, created_at, expires_at) VALUES (?, 'kakaotalk', '알프레드 상담', ?, ?)", [
    sha256Hex(PLATFORM_SEED.chatChannelToken),
    now,
    addSeconds(now, 86_400),
  ])
  for (const partner of [PLATFORM_SEED.partner, PLATFORM_SEED.overtax]) {
    execute(db, 'INSERT INTO partner_clients (id, name, api_key_hash, jwt_secret_enc, created_at) VALUES (?, ?, ?, ?, ?)', [
      partner.id,
      partner.id === 'overtax' ? '오버택스' : '데모 파트너',
      sha256Hex(partner.apiKey),
      cipher.encrypt(partner.jwtSecret),
      now,
    ])
  }
  execute(db, "INSERT INTO hometax_delegations (id, company_id, agency_name, status, requested_at) VALUES (?, 'c-corp', '알프레드 세무법인', 'requested', ?)", [
    PLATFORM_SEED.hometaxDelegationId,
    now,
  ])

  const grants: [id: string, title: string, regions: string[], industries: string[], endOn: string | null][] = [
    ['g-1', '서울시 소상공인 디지털 전환 지원', ['11'], [], '2026-12-31'],
    ['g-2', '중소기업 수출 바우처', [], [], null],
    ['g-3', '부산 제조업 스마트공장 지원', ['26'], ['C'], '2026-12-31'],
    ['g-4', '2026 상반기 고용 장려금', [], [], '2026-06-30'],
  ]
  for (const [id, title, regions, industries, endOn] of grants) {
    execute(
      db,
      `INSERT INTO grants (id, source, source_id, title, agency, region_codes, industry_codes, apply_start_on, apply_end_on, url, summary, fetched_at)
       VALUES (?, 'bizinfo', ?, ?, '중소벤처기업부', ?, ?, '2026-01-01', ?, ?, ?, ?)`,
      [id, id, title, JSON.stringify(regions), JSON.stringify(industries), endOn, `https://www.bizinfo.go.kr/${id}`, title, now],
    )
  }
}
