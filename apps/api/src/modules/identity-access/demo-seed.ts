import type { Id } from '../../shared/ids/ids.types.ts'
import { hashPassword } from './accounts/password-hash.ts'
import type { UserRecord } from './accounts/user.ts'
import type { Plan } from './actor.types.ts'
import type { AgencyAssignment } from './agency/agency-assignment-repository.ts'
import type { Company } from './companies/company.ts'
import type { Membership } from './members/membership.ts'
import { ROLE_TEMPLATES } from './permissions/permission-catalog.ts'
import type { RoleRecord } from './roles/role.ts'
import { DEMO_EMAIL } from './sessions/sessions.ts'
import type { AgreementRecord, Term } from './terms/term.ts'
import { TEST_COMPANY_ID, TEST_USER_ID } from './testing.ts'

/** 데모 계정 비밀번호입니다. 로컬 개발과 테스트에서만 씁니다. */
export const DEMO_PASSWORD = 'semu1234'

/** 데모 회사 ID입니다. 다른 컨텍스트의 메모리 시드가 같은 회사를 가리키도록 공개합니다. */
export const DEMO_COMPANY_IDS = {
  /** 법인, 세무 기장 + 급여 아웃소싱, 본사 대리인 담당. `testing.ts`의 `TEST_COMPANY_ID`와 같습니다. */
  corporation: TEST_COMPANY_ID,
  /** 개인사업자, 세무 기장. 소유자가 세무 약관에 아직 동의하지 않았습니다. */
  individual: 'cmp_01JBQ000000000000000000002' as Id<'company'>,
  /** 개인사업자, 무료 고객입니다. */
  free: 'cmp_01JBQ000000000000000000003' as Id<'company'>,
  /** 공개 데모 계정의 회사입니다. */
  demo: 'cmp_01JBQ000000000000000000004' as Id<'company'>,
} as const

/** 데모 사용자 ID입니다. */
export const DEMO_USER_IDS = {
  /** `owner@semu.example`: 법인과 무료 회사의 소유자(관리자). `TEST_USER_ID`와 같습니다. */
  owner: TEST_USER_ID,
  /** `member@semu.example`: 법인의 일반 사용자, 경리 권한 그룹 */
  member: 'usr_01JBQ000000000000000000002' as Id<'user'>,
  /** `agent@agency.example`: 세무 대리인 담당자, 법인·개인 회사 배정 */
  agent: 'usr_01JBQ000000000000000000003' as Id<'user'>,
  /** `manager@agency.example`: 세무 대리인 팀장, 담당자의 팀장 */
  manager: 'usr_01JBQ000000000000000000004' as Id<'user'>,
  /** `demo@semu.example`: 공개 데모 계정(읽기 전용) */
  demo: 'usr_01JBQ000000000000000000005' as Id<'user'>,
  /** `sole@semu.example`: 개인 회사 소유자, 세무 약관 미동의 */
  sole: 'usr_01JBQ000000000000000000006' as Id<'user'>,
} as const

/** 데모 회사별 플랜입니다. Billing의 메모리 시드가 같은 구독을 만듭니다. */
export const DEMO_PLANS: ReadonlyArray<readonly [Id<'company'>, ReadonlyArray<Plan>]> = [
  [DEMO_COMPANY_IDS.corporation, ['TAXATION', 'PAYROLL']],
  [DEMO_COMPANY_IDS.individual, ['TAXATION']],
  [DEMO_COMPANY_IDS.free, []],
  [DEMO_COMPANY_IDS.demo, ['TAXATION', 'PAYROLL']],
]

const CREATED_AT = '2026-01-02T00:00:00.000Z'
const BOOKKEEPING_ROLE_ID = 'rol_01JBQ000000000000000000001' as Id<'role'>

let cachedHash: string | undefined

/** 데모 비밀번호 해시입니다. scrypt가 느려 프로세스에서 한 번만 계산합니다. */
function demoPasswordHash(): string {
  cachedHash ??= hashPassword(DEMO_PASSWORD)
  return cachedHash
}

function company(
  id: Id<'company'>,
  name: string,
  businessNumber: string,
  businessType: Company['businessType'],
  agency?: Company['agency'],
): Company {
  return {
    id,
    name,
    businessNumber,
    businessType,
    representatives: [{ name: '김대표' }],
    regionCode: '11',
    industry: '소프트웨어 개발',
    ...(agency === undefined ? {} : { agency }),
    createdAt: CREATED_AT,
    version: 1,
  }
}

/** 데모 회사입니다. 사업자등록번호는 검증 숫자가 맞는 가짜 번호입니다. */
export function demoCompanies(): Company[] {
  const hq = { id: 'agc_01JBQ000000000000000000001' as Id<'agency'>, name: '세무법인 혜움', kind: 'HQ' as const }
  return [
    company(DEMO_COMPANY_IDS.corporation, '주식회사 세무', '1238145600', 'CORPORATION', hq),
    company(DEMO_COMPANY_IDS.individual, '세무 상점', '2208162517', 'INDIVIDUAL', hq),
    company(DEMO_COMPANY_IDS.free, '세무 카페', '1048145235', 'INDIVIDUAL'),
    company(DEMO_COMPANY_IDS.demo, '데모 주식회사', '1018100340', 'CORPORATION'),
  ]
}

function user(
  id: Id<'user'>,
  email: string,
  name: string,
  kind: UserRecord['kind'],
  extra: Partial<UserRecord> = {},
): UserRecord {
  return {
    id,
    email,
    name,
    kind,
    isDemo: false,
    passwordHash: demoPasswordHash(),
    status: 'ACTIVE',
    failedSignInCount: 0,
    createdAt: CREATED_AT,
    ...extra,
  }
}

/** 데모 사용자입니다. 비밀번호는 모두 {@link DEMO_PASSWORD}입니다. */
export function demoUsers(): UserRecord[] {
  return [
    user(DEMO_USER_IDS.owner, 'owner@semu.example', '김대표', 'CLIENT'),
    user(DEMO_USER_IDS.member, 'member@semu.example', '이경리', 'CLIENT'),
    user(DEMO_USER_IDS.agent, 'agent@agency.example', '박세무', 'AGENCY_STAFF', { managerId: DEMO_USER_IDS.manager }),
    user(DEMO_USER_IDS.manager, 'manager@agency.example', '최팀장', 'AGENCY_MANAGER'),
    user(DEMO_USER_IDS.demo, DEMO_EMAIL, '데모', 'CLIENT', { isDemo: true }),
    user(DEMO_USER_IDS.sole, 'sole@semu.example', '정사장', 'CLIENT'),
  ]
}

function membership(
  n: number,
  companyId: Id<'company'>,
  userId: Id<'user'>,
  access: Membership['access'],
  extra: Partial<Membership> = {},
): Membership {
  return {
    id: `mbr_01JBQ00000000000000000000${n}` as Id<'membership'>,
    companyId,
    userId,
    access,
    roleIds: [],
    isOwner: false,
    joinedAt: `2026-01-0${n}T00:00:00.000Z`,
    version: 1,
    ...extra,
  }
}

/** 데모 소속입니다. */
export function demoMemberships(): Membership[] {
  return [
    membership(1, DEMO_COMPANY_IDS.corporation, DEMO_USER_IDS.owner, 'ADMIN', { isOwner: true }),
    membership(2, DEMO_COMPANY_IDS.corporation, DEMO_USER_IDS.member, 'MEMBER', { roleIds: [BOOKKEEPING_ROLE_ID] }),
    membership(3, DEMO_COMPANY_IDS.free, DEMO_USER_IDS.owner, 'ADMIN', { isOwner: true }),
    membership(4, DEMO_COMPANY_IDS.demo, DEMO_USER_IDS.demo, 'ADMIN', { isOwner: true }),
    membership(5, DEMO_COMPANY_IDS.individual, DEMO_USER_IDS.sole, 'ADMIN', { isOwner: true }),
  ]
}

/** 데모 권한 그룹입니다. 법인 회사의 `경리` 그룹 하나입니다. */
export function demoRoles(): RoleRecord[] {
  const template = ROLE_TEMPLATES.find((entry) => entry.code === 'BOOKKEEPING')!
  return [
    {
      id: BOOKKEEPING_ROLE_ID,
      companyId: DEMO_COMPANY_IDS.corporation,
      name: template.name,
      permissions: [...template.permissions],
      templateCode: template.code,
      createdAt: CREATED_AT,
      version: 1,
    },
  ]
}

/** 데모 세무 대리인 배정입니다. 팀장은 팀원의 배정으로 두 회사를 봅니다. */
export function demoAssignments(): AgencyAssignment[] {
  return [
    { companyId: DEMO_COMPANY_IDS.corporation, userId: DEMO_USER_IDS.agent, assignedAt: CREATED_AT },
    { companyId: DEMO_COMPANY_IDS.individual, userId: DEMO_USER_IDS.agent, assignedAt: CREATED_AT },
  ]
}

function term(
  n: number,
  code: string,
  purpose: Term['purpose'],
  version: string,
  required: boolean,
  title: string,
): Term {
  return {
    id: `trm_01JBQ00000000000000000000${n}` as Id<'term'>,
    code,
    purpose,
    title,
    contentUrl: `https://semu.example/terms/${code.toLowerCase()}/${version}`,
    version,
    required,
    effectiveFrom: `${version}-01`,
  }
}

/** 데모 약관입니다. 이용약관은 옛 버전(2025-07)과 지금 버전(2026-01)이 있습니다. */
export function demoTerms(): Term[] {
  return [
    term(1, 'SERVICE', 'SIGNUP', '2025-07', true, '서비스 이용약관'),
    term(2, 'SERVICE', 'SIGNUP', '2026-01', true, '서비스 이용약관'),
    term(3, 'PRIVACY', 'SIGNUP', '2026-01', true, '개인정보 수집·이용 동의'),
    term(4, 'MARKETING', 'SIGNUP', '2026-01', false, '마케팅 정보 수신 동의'),
    term(5, 'TAX_SERVICE', 'TAX', '2026-01', true, '세무 기장 서비스 이용약관'),
    term(6, 'CONSULTING_PRIVACY', 'CONSULTING', '2026-01', true, '상담 신청 개인정보 수집·이용 동의'),
  ]
}

/** 데모 동의 기록입니다. `sole@semu.example`만 세무 약관에 동의하지 않았습니다. */
export function demoAgreements(): AgreementRecord[] {
  const current = demoTerms().filter((entry) => entry.version === '2026-01' && entry.purpose !== 'CONSULTING')
  const agreeAll = (userId: Id<'user'>, codes: ReadonlyArray<string>): AgreementRecord[] =>
    current
      .filter((entry) => codes.includes(entry.code))
      .map((entry) => ({
        userId,
        termId: entry.id,
        code: entry.code,
        version: entry.version,
        agreed: true,
        decidedAt: CREATED_AT,
      }))
  const all = ['SERVICE', 'PRIVACY', 'MARKETING', 'TAX_SERVICE']
  return [
    ...agreeAll(DEMO_USER_IDS.owner, all),
    ...agreeAll(DEMO_USER_IDS.member, all),
    ...agreeAll(DEMO_USER_IDS.demo, all),
    ...agreeAll(DEMO_USER_IDS.sole, ['SERVICE', 'PRIVACY', 'MARKETING']),
  ]
}
