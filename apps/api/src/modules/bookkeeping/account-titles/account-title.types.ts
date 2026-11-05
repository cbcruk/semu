import type { Id } from '../../../shared/ids/ids.types.ts'

/** 계정과목을 고를 수 있는 화면입니다. 매출·매입 증빙, 입금·출금 거래입니다. */
export type AccountScope = 'SALES' | 'PURCHASE' | 'DEPOSIT' | 'WITHDRAWAL'

/** 계정이 모이는 손익계산서 줄입니다. `NONE`은 손익에 넣지 않습니다(거래대금, 자산·부채). */
export type PlCategory =
  'REVENUE' | 'COGS' | 'SGA' | 'NON_OPERATING_INCOME' | 'NON_OPERATING_EXPENSE' | 'INCOME_TAX' | 'NONE'

/** 계정과목의 출처입니다. Alfred 기본, 회사가 추가, 하위 계정을 처음 만들 때 자동 생성한 `기타 {상위명}`입니다. */
export type AccountTitleOrigin = 'SYSTEM' | 'COMPANY' | 'AUTO_ETC'

/** 저장한 계정과목 한 행입니다. 기본 행은 `companyId`가 `null`입니다. */
export interface AccountTitleRecord {
  id: Id<'accountTitle'>
  companyId: Id<'company'> | null
  parentId: Id<'accountTitle'> | null
  depth: 1 | 2 | 3
  /** 기본 계정의 고유 코드입니다. 예: `trade.sales_in`. 회사 계정은 `null`입니다. */
  code: string | null
  name: string
  description: string | null
  appliesTo: ReadonlyArray<AccountScope>
  plCategory: PlCategory
  /** 자금 현황 `분류별` 묶음 이름입니다. 예: `매출 대금` */
  cashCategory: string | null
  origin: AccountTitleOrigin
  sortOrder: number
  version: number
}

/** 보고서와 분류 검사가 쓰는, 조상을 따라 풀어 낸 계정 정보입니다. */
export interface AccountTitleInfo {
  id: Id<'accountTitle'>
  name: string
  depth: 1 | 2 | 3
  plCategory: PlCategory
  cashCategory: string | null
  /** 보고서 줄 이름입니다. 2단계 조상(또는 자기 자신)의 이름입니다. */
  reportName: string
  /** 1단계 그룹 코드입니다. 예: 거래대금은 `trade` */
  groupCode: string | null
  appliesTo: ReadonlyArray<AccountScope>
  /** 거래를 분류할 수 있는지입니다. 하위 계정이 없는 2·3단계만 됩니다. */
  selectable: boolean
}

/** 분류할 수 없는 이유입니다. */
export type AssignabilityProblem = 'UNKNOWN' | 'SCOPE_MISMATCH' | 'NOT_SELECTABLE'

/** 하위 계정을 추가할 때 함께 일어나는 일입니다. */
export type ChildCreationPlan =
  | { ok: false; code: 'DEPTH_EXCEEDED' | 'NAME_DUPLICATE' }
  | {
      ok: true
      depth: 2 | 3
      /** 처음 하위 계정이 생기는 2단계 계정에 분류된 거래가 있으면 `기타 {상위명}`을 먼저 만들고 그리로 옮깁니다. */
      createAutoEtc: boolean
      autoEtcName: string
    }
