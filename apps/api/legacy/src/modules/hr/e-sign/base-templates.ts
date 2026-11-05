import type { DocumentCategoryCode } from '../documents/documents.types'
import type { EmploymentType } from '../shared/hr.types'
import type { BaseTemplate, DocumentKind, TemplateBlock, TemplateField } from './e-sign.types'

/** ID of 근로계약서(정규직, 5인이상), the default template of the issue screen and the demo seed. */
export const REGULAR_EMPLOYMENT_CONTRACT_TEMPLATE_ID = 1

const field = (key: string, label: string, type: TemplateField['type'], options: Partial<TemplateField> = {}): TemplateField => ({
  key,
  label,
  type,
  required: false,
  default: null,
  visible_toggle: false,
  source: null,
  signer: false,
  ...options,
})

const EMPLOYMENT_FIELDS: readonly TemplateField[] = [
  field('join_date', '구성원 입사일', 'date', { required: true, source: 'employee.join_date' }),
  field('contract_start_date', '근로계약 시작일', 'date', { required: true }),
  field('probation_months', '수습기간 개월수', 'number', { visible_toggle: true, default: 3 }),
  field('probation_pay_rate', '수습기간 지급률', 'number', { visible_toggle: true, default: 100 }),
  field('workplace', '근무장소', 'text', { source: 'work_condition.workplace' }),
  field('job_description', '업무내용', 'textarea', { required: true }),
  field('weekly_work_hours', '1주 소정근로시간', 'number', { required: true, default: 40 }),
  field('monthly_wage', '월급여', 'money', { required: true }),
  field('monthly_work_hours', '월 소정근로시간', 'number', { default: 209 }),
  field('signer_address', '근로자 주소', 'text', { signer: true }),
]

const CONTRACT_END_FIELD = field('contract_end_date', '근로계약 종료일', 'date', { required: true })

const CONTRACT_BODY: readonly TemplateBlock[] = [
  { type: 'heading', text: '근로계약서' },
  { type: 'clause', text: '근로계약기간: {{contract_start_date}}부터' },
  { type: 'clause', text: '근무장소: {{workplace}} / 업무내용: {{job_description}}' },
  { type: 'clause', text: '소정근로시간: 주 {{weekly_work_hours}}시간' },
  { type: 'clause', text: '임금: 월 {{monthly_wage}}원 (월 소정근로시간 {{monthly_work_hours}}시간)' },
  { type: 'clause', text: '수습기간: {{probation_months}}개월, 지급률 {{probation_pay_rate}}%' },
]

const CERTIFICATE_FIELDS: readonly TemplateField[] = [
  field('name', '성명', 'text', { source: 'employee.name' }),
  field('birth_date', '생년월일', 'date', { source: 'employee.birth_date' }),
  field('department', '부서', 'text', { source: 'employee.department' }),
  field('position', '직위', 'text', { source: 'employee.position' }),
  field('join_date', '입사일', 'date', { source: 'employee.join_date' }),
  field('purpose', '용도', 'text', { required: true }),
  field('submit_to', '제출처', 'text'),
]

const template = (
  id: number,
  title: string,
  documentKind: DocumentKind,
  category: DocumentCategoryCode,
  options: {
    contractType?: 'regular' | 'contract' | null
    workplaceSize?: 'gte5' | 'lt5' | null
    target?: EmploymentType
    isCertificate?: boolean
    fields: readonly TemplateField[]
    body?: readonly TemplateBlock[]
  },
): BaseTemplate => ({
  id,
  category,
  title,
  document_kind: documentKind,
  contract_type: options.contractType ?? null,
  workplace_size: options.workplaceSize ?? null,
  target_employment_type: options.target ?? 'wageemployee',
  is_certificate: options.isCertificate ?? false,
  body: [...(options.body ?? [{ type: 'heading', text: title }])],
  fields: [...options.fields],
})

const employment = (id: number, title: string, contractType: 'regular' | 'contract', workplaceSize: 'gte5' | 'lt5', kind: DocumentKind = 'employment_contract'): BaseTemplate =>
  template(id, title, kind, 'contract', {
    contractType,
    workplaceSize,
    fields: contractType === 'contract' ? [...EMPLOYMENT_FIELDS.slice(0, 2), CONTRACT_END_FIELD, ...EMPLOYMENT_FIELDS.slice(2)] : EMPLOYMENT_FIELDS,
    body: CONTRACT_BODY,
  })

/**
 * Templates shipped with the product, shared by e-sign and certificate issuance (rule R30).
 *
 * IDs are stable: company edits are stored as overrides keyed by these IDs. Titles and field labels are product data.
 */
export const BASE_TEMPLATES: readonly BaseTemplate[] = [
  employment(1, '근로계약서(정규직, 5인이상)', 'regular', 'gte5'),
  employment(2, '근로계약서(정규직, 5인미만)', 'regular', 'lt5'),
  employment(3, '근로계약서(계약직, 5인이상)', 'contract', 'gte5'),
  employment(4, '근로계약서(계약직, 5인미만)', 'contract', 'lt5'),
  template(5, '근로계약서(일용직)', 'daily_employment_contract', 'contract', {
    target: 'dailyemployee',
    fields: [field('work_date', '근로일', 'date', { required: true }), field('daily_wage', '일급', 'money', { required: true }), field('workplace', '근무장소', 'text')],
  }),
  employment(6, '단시간 근로자 근로계약서(정규직, 5인이상)', 'regular', 'gte5', 'part_time_employment_contract'),
  template(7, '연봉계약서(정규직)', 'annual_salary_contract', 'contract', {
    contractType: 'regular',
    fields: [field('contract_start_date', '급여계약 시작일', 'date', { required: true }), field('annual_salary', '연봉', 'money', { required: true })],
  }),
  template(8, '연봉계약서(계약직)', 'annual_salary_contract', 'contract', {
    contractType: 'contract',
    fields: [
      field('contract_start_date', '급여계약 시작일', 'date', { required: true }),
      CONTRACT_END_FIELD,
      field('annual_salary', '연봉', 'money', { required: true }),
    ],
  }),
  template(9, '용역계약서', 'service_contract', 'contract', {
    target: 'businessemployee',
    fields: [field('service_description', '용역 내용', 'textarea', { required: true }), field('service_fee', '용역 대금', 'money', { required: true })],
  }),
  template(10, '개인정보 수집·이용 동의서', 'privacy_consent', 'consent', { fields: [field('agreed', '동의 여부', 'select', { signer: true })] }),
  template(11, '비밀유지서약서', 'nda', 'consent', { fields: [field('signer_address', '서약자 주소', 'text', { signer: true })] }),
  template(12, '사직서', 'resignation', 'resignation', {
    fields: [field('leave_date', '퇴직 희망일', 'date', { signer: true }), field('resignation_note', '사직 사유', 'textarea', { signer: true })],
  }),
  template(13, '재직증명서', 'employment_certificate', 'certificate', { isCertificate: true, fields: CERTIFICATE_FIELDS }),
  template(14, '경력증명서', 'career_certificate', 'certificate', {
    isCertificate: true,
    fields: [...CERTIFICATE_FIELDS, field('leave_date', '퇴사일', 'date', { source: 'employee.leave_date' }), field('job_description', '담당업무', 'text')],
  }),
  template(15, '퇴직증명서', 'retirement_certificate', 'certificate', {
    isCertificate: true,
    fields: [...CERTIFICATE_FIELDS, field('leave_date', '퇴사일', 'date', { required: true, source: 'employee.leave_date' })],
  }),
  template(16, '표준취업규칙', 'work_rules', 'certificate', { isCertificate: true, fields: [field('effective_date', '시행일', 'date')] }),
]

/** Finds a base template by ID. */
export function findBaseTemplate(id: number): BaseTemplate | undefined {
  return BASE_TEMPLATES.find((candidate) => candidate.id === id)
}
