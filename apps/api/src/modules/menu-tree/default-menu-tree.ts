import type { MenuNodeSource } from './menu-tree.types'

/** Menu tree seeded for local development and tests. Labels are product data shown to Korean users. */
export const DEFAULT_MENU_TREE: MenuNodeSource[] = [
  section(1, '홈', 'home', [group(11, '홈', [leaf(111, '오늘의 할 일', 'today', '/today')])]),
  section(2, '실시간 보고서', 'chart', [
    group(21, '실시간 보고서', [leaf(211, '예상 부가세', 'estimated_vat', '/reports/estimated-vat')]),
  ]),
  section(3, '세무', 'tax', [
    group(31, '세무 신고', [
      leaf(311, '부가세', 'tax_surtax', '/tax/surtax'),
      leaf(312, '원천세', 'tax_withholding', '/tax/withholding-tax'),
      leaf(313, '법인세', 'tax_corporation', '/tax/corporation-tax'),
      leaf(314, '종합소득세', 'tax_aggr_income', '/tax/aggr-income-tax'),
    ]),
  ]),
  section(4, '인사', 'people', [group(41, '인사', [leaf(411, '직원 관리', 'employee_management', '/employee')])]),
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
