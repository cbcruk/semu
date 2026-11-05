/** 템플릿의 입력 필드입니다. */
export interface TemplateField {
  key: string
  label: string
  type: 'TEXT' | 'TEXTAREA' | 'DATE' | 'NUMBER' | 'MONEY' | 'SELECT'
  required: boolean
  default?: string | number | undefined
  /** 조항을 숨길 수 있는지입니다([표시/숨김]). */
  hideable: boolean
  /** 미리 채울 직원 값입니다. 예: `employee.joinDate` */
  source?: string | undefined
  /** 관리자가 아니라 서명자가 채우는 필드인지입니다. */
  signer: boolean
}

/** 발송 검증에 쓰는 문서 하나입니다. */
export interface SendDocument {
  index: number
  templateActive: boolean
  fields: ReadonlyArray<TemplateField>
  defaultCompanySealId?: string | undefined
}

/** 발송 검증 입력입니다. */
export interface SendCheckInput {
  recipient: {
    email?: string | undefined
    isForeigner: boolean
    nationalityCode?: string | undefined
    visaCode?: string | undefined
  }
  documents: ReadonlyArray<SendDocument>
  /** 문서 번호별 관리자 입력값입니다. */
  fieldValues: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  /** 문서 번호별 숨긴 필드 키입니다. */
  hiddenFields: Readonly<Record<string, ReadonlyArray<string>>>
  /** 수신자가 직원이면 `source`로 읽을 값입니다. 예: `{ 'employee.joinDate': '2026-01-02' }` */
  sourceValues: Readonly<Record<string, unknown>>
  companySealId?: string | undefined
}
