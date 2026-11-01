import type { AgreementHistoryRow, TermAgreementView, TermRow } from './terms.types'

/**
 * Decides whether a term must be asked again, mirroring the client guard.
 *
 * Required terms need an agreement at the current version; optional terms are
 * asked again whenever a new version appears, even if previously declined.
 */
export function needsConsent(view: Pick<TermAgreementView, 'is_required' | 'version' | 'history'>): boolean {
  if (view.is_required) return view.history === null || !view.history.is_agreed || view.history.version !== view.version
  return view.history?.version !== view.version
}

/** Serializes a term together with the subject's latest agreement. */
export function toTermView(term: TermRow, history: AgreementHistoryRow | null): TermAgreementView {
  const base = {
    id: term.id,
    code: term.code,
    title: term.title,
    content_url: term.content_url,
    version: term.version,
    is_required: term.is_required === 1,
    purpose_code: term.purpose_code,
    history: history === null ? null : { is_agreed: history.is_agreed === 1, version: history.version, agreed_at: history.agreed_at },
  }
  return { ...base, needs_consent: needsConsent(base) }
}

/** Serializes a term without agreement state, for `GET /api/terms/`. */
export function toTermSummary(term: TermRow): Omit<TermAgreementView, 'history' | 'needs_consent'> {
  return {
    id: term.id,
    code: term.code,
    title: term.title,
    content_url: term.content_url,
    version: term.version,
    is_required: term.is_required === 1,
    purpose_code: term.purpose_code,
  }
}
