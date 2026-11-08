import { ulid } from 'ulid'
import type { Id, IdKind } from './ids.types.ts'

/**
 * API에 노출하는 엔터티 종류별 ID 접두사입니다.
 *
 * ID 규칙은 `docs/design/conventions.md`를 보세요.
 */
export const ID_PREFIXES = {
  company: 'cmp',
  user: 'usr',
  membership: 'mbr',
  session: 'ses',
  role: 'rol',
  invitation: 'inv',
  term: 'trm',
  subscription: 'sub',
  billingMandate: 'mdt',
  payment: 'pay',
  serviceContract: 'svc',
  lead: 'led',
  partnerLink: 'pln',
  integration: 'int',
  certificate: 'crt',
  scrapRequest: 'scr',
  hometaxDelegation: 'dlg',
  conversation: 'cnv',
  message: 'msg',
  grant: 'grt',
  agency: 'agc',
  filing: 'fil',
  requirement: 'req',
  actionCard: 'acd',
  file: 'fle',
  filingDocument: 'fdc',
  employee: 'emp',
  department: 'dpt',
  position: 'pos',
  memo: 'mem',
  familyMember: 'fam',
  leave: 'lev',
  workContract: 'wct',
  payrollContract: 'pct',
  document: 'doc',
  insuranceFiling: 'isf',
  esignRequest: 'esr',
  esignTemplate: 'est',
  certificateIssuance: 'cis',
  companySeal: 'sel',
  documentForm: 'dfm',
  payrollLedger: 'pyl',
  payrollRow: 'pyr',
  earner: 'ern',
  payslip: 'psl',
  paymentItem: 'pit',
  deductionItem: 'dit',
  workSchedulePolicy: 'wsp',
  severanceSettlement: 'sev',
  rateTable: 'rtb',
  evidence: 'evd',
  accountTitle: 'acc',
  partner: 'ptn',
  classificationRule: 'rul',
  bankAccount: 'bka',
  bankTransaction: 'btx',
  settlementLink: 'stl',
  salesTransaction: 'stx',
  taxInvoice: 'ivc',
  giro: 'gir',
  settlementClosing: 'clo',
  job: 'job',
  event: 'evt',
} as const

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

/**
 * 주어진 엔터티 종류의 새 ID를 만듭니다.
 *
 * @example 직원 ID 만들기
 * ```ts
 * import { newId } from "./ids.ts";
 *
 * const id = newId("employee"); // "emp_01J..."
 * ```
 */
export function newId<K extends IdKind>(kind: K, time?: number): Id<K> {
  return `${ID_PREFIXES[kind]}_${ulid(time)}` as Id<K>
}

/**
 * 값이 주어진 종류의 올바른 형식 ID인지 확인합니다.
 *
 * 경로·본문으로 받은 ID는 다른 종류의 ID가 섞여 들어오지 않도록 접두사와 ULID 형식을 함께 검사합니다.
 */
export function isId<K extends IdKind>(kind: K, value: unknown): value is Id<K> {
  if (typeof value !== 'string') return false
  const prefix = `${ID_PREFIXES[kind]}_`
  return value.startsWith(prefix) && ULID_PATTERN.test(value.slice(prefix.length))
}
