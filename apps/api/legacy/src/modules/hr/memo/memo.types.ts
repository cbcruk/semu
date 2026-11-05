/** A row of `employee_memos`. */
export interface MemoRow {
  content: string
  updated_by: string | null
  updated_at: string
}

/** A row of `employee_memo_histories`. */
export interface MemoHistoryRow {
  id: number
  action: 'updated' | 'deleted'
  content: string | null
  created_by: string | null
  created_at: string
}
