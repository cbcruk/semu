import type { MenuNodeSource } from './menu-tree.types'

/** Menu tree seeded for local development and tests. Labels are product data shown to Korean users. */
export const DEFAULT_MENU_TREE: MenuNodeSource[] = [
  section(1, '홈', 'home', [
    group(11, '홈', [
      leaf(111, '오늘의 할 일', 'today', '/today'),
      leaf(112, 'AI 비서', 'ai_agent', '/ai-agent'),
      leaf(113, '지원금 추천', 'grant_recommendation', '/recommend/grant'),
    ]),
  ]),
  section(2, '실시간 보고서', 'chart', [
    group(21, '실시간 보고서', [
      leaf(212, '손익 현황', 'realtime_profit_loss', '/reports/profit-loss/status'),
      leaf(213, '자금 현황', 'realtime_cash', '/reports/cash/daily-fund-report'),
      leaf(211, '예상 부가세', 'estimated_vat', '/reports/estimated-vat'),
    ]),
  ]),
  section(5, '세무 보고서', 'report', [
    group(51, '손익계산서', [
      leaf(511, '손익계산서', 'report_profit_loss', '/settlement-reports/profit-loss/statement'),
      leaf(512, '비용 분석', 'settlement_reports_profit_loss_cost_details', '/settlement-reports/profit-loss/cost-details'),
      leaf(513, '인건비 내역', 'settlement_reports_profit_loss_labor_cost', '/settlement-reports/profit-loss/labor-cost'),
    ]),
    group(52, '자금 보고', [leaf(521, '자금 보고', 'report_cash', '/settlement-reports/cash/flow')]),
    group(53, '재무상태표', [leaf(531, '재무상태표', 'report_financial_position', '/settlement-reports/financial-position')]),
  ]),
  section(6, '경리', 'wallet', [
    group(61, '증빙 관리', [
      leaf(611, '매출 증빙 관리', 'bookkeeping_sales_evidence', '/evidence/sales/tax-invoice'),
      leaf(612, '매입 증빙 관리', 'bookkeeping_purchase_evidence', '/evidence/purchase/tax-invoice'),
    ]),
    group(62, '자금 관리', [
      leaf(621, '입출금 관리', 'bookkeeping_bank_transactions', '/bank/bank-transactions'),
      leaf(622, '계좌 목록', 'bookkeeping_bank_accounts', '/bank/accounts'),
    ]),
    group(63, '거래 관리', [
      leaf(631, '거래처 관리', 'bookkeeping_partners', '/partners'),
      leaf(632, '세금계산서 발급', 'bookkeeping_sales_transactions', '/transactions/manage/sales/list'),
      leaf(633, '세금 납부', 'bookkeeping_tax_payment', '/tax-payment/todo'),
    ]),
  ]),
  section(4, '인사', 'people', [
    group(41, '인사', [
      leaf(412, '구성원 정보', 'employment_employee', '/employee'),
      leaf(411, '직원 관리', 'employee_management', '/employment'),
      leaf(413, '전자서명', 'employment_e_sign', '/e-signature'),
      leaf(414, '제증명 발급', 'employment_certificate', '/certificate-issuance'),
    ]),
  ]),
  section(7, '급여', 'money', [
    group(71, '급여', [
      leaf(711, '급여 정산', 'payroll_settlement', '/payroll-settlement'),
      leaf(712, '급여 관리', 'payroll_management', '/company/payroll'),
      leaf(713, '급여 계산기', 'salary_calculator', '/salary-calculator/wage'),
    ]),
  ]),
  section(3, '세무', 'tax', [
    group(31, '세무 신고', [
      leaf(311, '부가세', 'tax_surtax', '/tax/surtax'),
      leaf(312, '원천세', 'tax_withholding', '/tax/withholding-tax'),
      leaf(313, '법인세', 'tax_corporation', '/tax/corporation-tax'),
      leaf(314, '종합소득세', 'tax_aggr_income', '/tax/aggr-income-tax'),
    ]),
  ]),
  section(8, '서식·증명서', 'document', [group(81, '서식·증명서', [leaf(811, '서식 모음', 'document_form', '/document/document-form-list')])]),
  section(9, '설정', 'settings', [
    group(91, '회사·사용자 관리', [
      leaf(911, '회사 관리', 'company_management', '/settings/company'),
      leaf(912, '사용자 관리', 'user_management', '/settings/user'),
    ]),
    group(92, '운영 설정', [
      leaf(921, '급여 설정', 'payroll_setting', '/payroll-setting/conditions-of-employment'),
      leaf(922, '경리 설정', 'settings_accounting', '/settings/accounting'),
    ]),
    group(93, '전자서명·제증명 관리', [leaf(931, '전자서명·제증명 관리', 'settings_e_sign', '/e-signature-setting/e-signature-templates')]),
    group(94, '기관 연동 및 인증서 관리', [
      leaf(941, '세무신고 기관 연동', 'integrate_tax', '/integrate/tax'),
      leaf(942, '내역 수집 기관 연동', 'integrate_transaction', '/integrate/transaction'),
      leaf(943, '공동 인증서 관리', 'cert_management', '/manage/cert'),
      leaf(944, '외부 서비스 연동', 'external_services', '/integrate/external'),
    ]),
    group(95, '서비스 이용 및 결제 관리', [
      leaf(951, '서비스 및 결제', 'service_payment', '/settings/plan'),
      leaf(952, '계약서 및 동의서', 'contract_consent', '/settings/contract'),
    ]),
  ]),
]

function section(id: number, name: string, icon: string, children: MenuNodeSource[]): MenuNodeSource {
  return { id, name, code: null, icon, to: null, children }
}

function group(id: number, name: string, children: MenuNodeSource[]): MenuNodeSource {
  return { id, name, code: null, icon: '', to: null, children }
}

function leaf(id: number, name: string, code: MenuNodeSource['code'], to: string): MenuNodeSource {
  return { id, name, code, icon: '', to, children: [] }
}
