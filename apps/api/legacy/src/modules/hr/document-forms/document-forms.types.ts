/** Category of a form in the 서식 모음 catalog. */
export type DocumentFormType = '인사' | '경리' | '부동산' | '주식' | '이사회' | '일반계약'

/** One downloadable form of the 서식 모음 catalog. */
export interface DocumentForm {
  id: number
  title: string
  description: string
  type: DocumentFormType
  /** Download URL of the form file, or `null` while the file is not hosted. */
  file_url: string | null
}
