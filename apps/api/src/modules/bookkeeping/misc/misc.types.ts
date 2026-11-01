/** Claims carried by a signed attachment upload token. */
export interface UploadTokenPayload {
  /** Company the file will belong to. */
  companyId: string
  /** User who asked for the URL, recorded as the uploader. */
  userId: string
  /** File ID reserved for the upload. */
  fileId: string
  fileName: string
  /** Expiry in Unix seconds. */
  expiresAt: number
}

/** A row of `company_share_histories`. */
export interface ShareHistoryRow {
  id: string
  company_id: string
  receivers: string
  detail: string
  representative_image_id: string | null
  bankbook_image_id: string | null
  sent_by: string
  created_at: string
}

/** A row of `company_business_types`. */
export interface BusinessTypeRow {
  company_id: string
  seq: number
  code: string
  business_type: string
  business_class: string
  is_main: 0 | 1
  updated_at: string
}

/** The year-end settlement window of a year. */
export interface YearEndPeriod {
  is_period: boolean
  start: string
  end: string
}
