/** What `export-to-desk` sends to the bookkeeping desk (세무사랑 추정). */
export interface DeskExportRequest {
  companyId: string
  cardId: number
  /** `payroll_ledger` (급여대장) or `journal` (인건비 분개); values are unconfirmed (spec 8.4). */
  exportType: 'payroll_ledger' | 'journal'
  attributionMonth: string
  paymentDate: string
  rows: { name: string; incomeType: string; grossPay: number; deductionTotal: number; netPay: number; incomeTax: number; localIncomeTax: number }[]
}

/** The desk's answer to an export. */
export type DeskExportResult = { ok: true; reference: string } | { ok: false; error: string }

/** Sends closed payroll ledgers to the bookkeeping desk. */
export interface DeskExportAdapter {
  /** Exports a card, resolving with the desk's verdict instead of throwing. */
  export(request: DeskExportRequest): Promise<DeskExportResult>
}

/** What linking Shiftee needs: the company to create and its first administrator. */
export interface ShifteeLinkRequest {
  companyName: string
  representativeName: string
  email: string
}

/** Shiftee's answer to a link request. */
export type ShifteeLinkResult = { ok: true; externalCompanyId: string } | { ok: false; error: string }

/** Creates and unlinks Shiftee (근태) companies. */
export interface ShifteeAdapter {
  /** Creates a Shiftee company and its super administrator. */
  createCompany(request: ShifteeLinkRequest): Promise<ShifteeLinkResult>
  /** Releases the link on Shiftee's side. */
  unlink(externalCompanyId: string): Promise<void>
}

/** The external effects the payroll domain depends on besides HR's notifier and PDF renderer. */
export interface PayrollAdapters {
  deskExport: DeskExportAdapter
  shiftee: ShifteeAdapter
}
