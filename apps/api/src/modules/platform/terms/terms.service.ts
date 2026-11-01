import type { ServiceDeps } from '../../../app.types'
import { queryAll, transaction } from '../../../db/query'
import { invalidField } from '../../../lib/domain-error'
import {
  deleteLegacyTaxAgreement,
  findTerm,
  insertAgreement,
  insertLegacyTaxAgreement,
  latestAgreements,
  listCurrentTerms,
  setMarketingAgreed,
} from './terms.repository'
import type { AgreementInput, AgreementSubject, TermAgreementView, TermRow } from './terms.types'
import { needsConsent, toTermView } from './terms.utils'

/** Purpose whose required terms gate taxation customers. */
export const TAX_PURPOSE = 'tax'
/** Term code of the optional marketing consent. */
export const MARKETING_TERM_CODE = 'marketing'

/** Lists the current terms of a purpose with the subject's agreement history and whether to ask again. */
export function listTermAgreements(deps: ServiceDeps, subject: AgreementSubject, purposeCode: string): TermAgreementView[] {
  const terms = listCurrentTerms(deps.db, purposeCode, deps.clock.today())
  const history = latestAgreements(
    deps.db,
    subject,
    terms.map((term) => term.code),
  )
  return terms.map((term) => toTermView(term, history.get(term.code) ?? null))
}

/** Checks whether every current term of a purpose is settled for the subject. */
export function hasSettledTerms(deps: ServiceDeps, subject: AgreementSubject, purposeCode: string): boolean {
  return listTermAgreements(deps, subject, purposeCode).every((view) => !view.needs_consent)
}

/**
 * Records agreement answers and keeps the legacy tax consent row in sync.
 *
 * Answers must refer to terms currently in effect, and required terms cannot
 * be declined. Once every required tax term is agreed at its current version,
 * the `term_agreements` row that {@linkcode loadAccessContext} checks is written.
 *
 * @param taxTermsVersion The deployment's tax terms version from `AppDeps`.
 * @throws {DomainError} `VALIDATION_FAILED` for unknown, outdated or declined required terms.
 */
export function recordAgreements(
  deps: ServiceDeps,
  subject: AgreementSubject,
  answers: readonly AgreementInput[],
  client: { ip: string | null; userAgent: string | null },
  taxTermsVersion: string,
): TermRow[] {
  const today = deps.clock.today()
  const now = deps.clock.now()
  const resolved = answers.map((answer, index) => ({ term: resolveCurrentTerm(deps, answer, today, index), isAgreed: answer.is_agreed }))
  for (const [index, { term, isAgreed }] of resolved.entries()) {
    if (term.is_required === 1 && !isAgreed) throw invalidField(`agreements.${index}.is_agreed`, `${term.title} is required.`)
  }
  transaction(deps.db, () => {
    for (const { term, isAgreed } of resolved) {
      insertAgreement(deps.db, subject, term, isAgreed, now, client)
      if ('userId' in subject && term.code === MARKETING_TERM_CODE) setMarketingAgreed(deps.db, subject.userId, isAgreed)
    }
    if ('userId' in subject && resolved.some(({ term }) => term.purpose_code === TAX_PURPOSE)) {
      const settled = listTermAgreements(deps, subject, TAX_PURPOSE).every((view) => !view.is_required || !needsConsent(view))
      if (settled) insertLegacyTaxAgreement(deps.db, subject.userId, taxTermsVersion, now)
      else deleteLegacyTaxAgreement(deps.db, subject.userId, taxTermsVersion)
    }
  })
  return resolved.map(({ term }) => term)
}

/**
 * Checks that the answers cover every required current term of a purpose.
 *
 * @throws {DomainError} `VALIDATION_FAILED` on `agreements` naming the missing terms.
 */
export function assertRequiredTermsAnswered(deps: ServiceDeps, purposeCode: string, answers: readonly AgreementInput[]): void {
  const today = deps.clock.today()
  const agreedIds = new Set(
    answers.filter((answer) => answer.is_agreed).map((answer, index) => resolveCurrentTerm(deps, answer, today, index).id),
  )
  const missing = listCurrentTerms(deps.db, purposeCode, today).filter((term) => term.is_required === 1 && !agreedIds.has(term.id))
  if (missing.length > 0) throw invalidField('agreements', `Agree to the required terms: ${missing.map((term) => term.code).join(', ')}.`)
}

function resolveCurrentTerm(deps: ServiceDeps, answer: AgreementInput, today: string, index: number): TermRow {
  const byId = answer.term_id === undefined ? undefined : findTerm(deps.db, answer.term_id)
  const purpose = byId?.purpose_code
  const code = byId?.code ?? answer.code
  if (code === undefined) throw invalidField(`agreements.${index}`, 'Send term_id or code.')
  const current = findCurrentByCode(deps, code, purpose, today)
  if (current === undefined) throw invalidField(`agreements.${index}`, 'Unknown term.')
  if (byId !== undefined && byId.id !== current.id) throw invalidField(`agreements.${index}.term_id`, 'This term has a newer version; reload the terms.')
  return current
}

function findCurrentByCode(deps: ServiceDeps, code: string, purpose: string | undefined, today: string): TermRow | undefined {
  const purposes =
    purpose === undefined
      ? queryAll<{ purpose_code: string }>(deps.db, 'SELECT DISTINCT purpose_code FROM terms WHERE code = ?', [code]).map((row) => row.purpose_code)
      : [purpose]
  for (const candidate of purposes) {
    const found = listCurrentTerms(deps.db, candidate, today).find((term) => term.code === code)
    if (found !== undefined) return found
  }
  return undefined
}
