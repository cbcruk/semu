/** A row of the `terms` table: one version of one term. */
export interface TermRow {
  id: number
  code: string
  purpose_code: string
  title: string
  content_url: string
  version: string
  is_required: 0 | 1
  audience: 'all' | 'taxation'
  effective_from: string
  created_at: string
}

/** The latest agreement a user or guest recorded for a term code. */
export interface AgreementHistoryRow {
  term_code: string
  version: string
  is_agreed: 0 | 1
  agreed_at: string
}

/** One answer in an agreement request; `term_id` or `code` identifies the term. */
export interface AgreementInput {
  term_id?: number | undefined
  code?: string | undefined
  is_agreed: boolean
}

/** Whose agreement is recorded: a signed-in user or a guest identified by email. */
export type AgreementSubject = { userId: string } | { email: string }

/** A term with the subject's agreement state, as returned by the term agreement endpoints. */
export interface TermAgreementView {
  id: number
  code: string
  title: string
  content_url: string
  version: string
  is_required: boolean
  purpose_code: string
  history: { is_agreed: boolean; version: string; agreed_at: string } | null
  needs_consent: boolean
}
