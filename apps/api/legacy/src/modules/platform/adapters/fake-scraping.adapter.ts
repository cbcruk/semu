import type { SalesSource } from '../../estimated-vat/estimated-vat.types'
import { createHash } from 'node:crypto'
import type {
  CandidateQuery,
  CertificateMaterial,
  CredentialCheck,
  CredentialCheckResult,
  GiroJoinRequest,
  ScrapCandidate,
  ScrapingAdapter,
  ScrapJob,
  ScrapOutcome,
  ScrapRecord,
} from './scraping.adapter'

const WRONG_PREFIX = 'wrong'

/**
 * Creates a deterministic {@linkcode ScrapingAdapter} for tests and local development.
 *
 * - Any password, key or signing password starting with `wrong` is rejected.
 * - Each card company or bank yields two cards or accounts; each delivery app two stores.
 * - Items whose external key contains `fail` fail to scrape with a retryable error.
 *
 * @example Rejected credentials
 * ```ts
 * import { createFakeScrapingAdapter } from './fake-scraping.adapter'
 *
 * const adapter = createFakeScrapingAdapter()
 * await adapter.verifyCredential({
 *   type: 'cardsales',
 *   subCode: null,
 *   isCorporate: true,
 *   businessNumber: '1238145600',
 *   credential: { authType: 'id', accountId: 'me', password: 'wrong-pw' },
 * }) // { ok: false, code: 'INVALID_CREDENTIAL', ... }
 * ```
 */
export function createFakeScrapingAdapter(): ScrapingAdapter {
  return {
    verifyCredential(check: CredentialCheck): Promise<CredentialCheckResult> {
      return Promise.resolve(checkSecrets(check))
    },
    listCandidates(query: CandidateQuery): Promise<ScrapCandidate[]> {
      const verdict = checkSecrets(query)
      if (!verdict.ok) return Promise.reject(new Error(verdict.message))
      return Promise.resolve([1, 2].map((index) => candidate(query, index)))
    },
    scrape(job: ScrapJob): Promise<ScrapOutcome> {
      if (job.itemExternalKey?.includes('fail') === true) {
        return Promise.resolve({ status: 'fail', code: 'INSTITUTION_UNAVAILABLE', message: 'The institution did not respond.', isRetryable: true })
      }
      const seed = digest(`${job.integrationId}:${job.itemExternalKey ?? ''}`)
      return Promise.resolve({
        status: 'success',
        records: fakeRecords(job, seed),
      })
    },
    checkCertificatePassword(material: CertificateMaterial): Promise<boolean> {
      return Promise.resolve(!material.signPw.startsWith(WRONG_PREFIX))
    },
    joinGiro(request: GiroJoinRequest): Promise<CredentialCheckResult> {
      if (request.giroPw.startsWith(WRONG_PREFIX)) return Promise.resolve({ ok: false, code: 'GIRO_JOIN_REJECTED', message: 'Internet Giro rejected the sign-up.' })
      return Promise.resolve({ ok: true })
    },
  }
}


function checkSecrets(check: CredentialCheck): CredentialCheckResult {
  const { credential } = check
  const secrets = [credential.password, credential.certificate?.signPw, ...Object.values(credential.keys ?? {})]
  if (secrets.some((secret) => secret?.startsWith(WRONG_PREFIX) === true)) {
    return { ok: false, code: 'INVALID_CREDENTIAL', message: 'The institution rejected the credentials.' }
  }
  return { ok: true }
}

function candidate(query: CandidateQuery, index: number): ScrapCandidate {
  const seed = digest(`${query.type}:${query.subCode}:${query.businessNumber}`)
  const digits = (Number.parseInt(seed.slice(0, 8), 16) % 1e8).toString().padStart(8, '0')
  if (query.type === 'creditcard') {
    return { externalKey: `${query.subCode}-card-${index}`, name: `법인카드 ${index}`, number: `9410${digits}000${index}`, subCode: query.subCode }
  }
  if (query.type === 'bank') {
    return {
      externalKey: `${query.subCode}-account-${index}`,
      name: `입출금 ${index}`,
      number: `1002${digits}${index}`,
      subCode: query.subCode,
      accountType: '01',
      currencyCode: 'KRW',
      holder: '예금주',
      openDate: '2020-01-01',
      balance: index * 1_000_000,
    }
  }
  return { externalKey: `${query.subCode}-store-${index}`, name: `매장 ${index}`, number: null, subCode: query.subCode }
}

function fakeRecords(job: ScrapJob, seed: string): ScrapRecord[] {
  const key = job.itemExternalKey ?? 'all'
  const amountAt = (index: number): number => ((Number.parseInt(seed.slice(index, index + 4), 16) % 900) + 100) * 1000
  const id = (index: number): string => `${job.integrationId}-${key}-${index}`
  switch (job.type) {
    case 'bank':
    case 'speedbank': {
      const account = { bank_code: job.subCode ?? '004', account_number: String(Number.parseInt(seed.slice(0, 8), 16)).padStart(11, '0') }
      return [
        { kind: 'bank_account', ...account, account_type: '01', external_key: `${job.integrationId}-${key}` },
        ...[1, 2].map(
          (index): ScrapRecord => ({
            kind: 'bank_transaction',
            ...account,
            external_key: id(index),
            transacted_at: `2026-10-31T1${index}:00:00+09:00`,
            amount: index === 1 ? amountAt(index) : -amountAt(index),
            summary: `fake transfer ${index}`,
          }),
        ),
      ]
    }
    case 'creditcard':
      return [1, 2].map((index) => ({
        kind: 'card_transaction',
        card_number_masked: '1234-****-****-5678',
        approval_no: id(index),
        approved_at: `2026-10-31T1${index}:00:00+09:00`,
        merchant_name: `가맹점 ${index}`,
        total_amount: amountAt(index),
      }))
    case 'hometax':
      return [1, 2].map((index) => ({
        kind: 'purchase_evidence',
        source: 'tax_invoice',
        external_key: id(index),
        issued_on: '2026-10-31',
        supply_amount: amountAt(index),
        vat_amount: amountAt(index) / 10,
      }))
    case 'giro':
      return [{ kind: 'giro_bills', bills: [] }]
    default:
      return [1, 2].map((index) => ({
        kind: 'sales_evidence',
        source: SALES_SOURCE[job.type] ?? 'card',
        external_key: id(index),
        issued_on: '2026-10-31',
        total_amount: amountAt(index),
      }))
  }
}

const SALES_SOURCE: Partial<Record<ScrapJob['type'], SalesSource>> = { cardsales: 'card', pg: 'pg', delivery: 'delivery', allra: 'mall' }

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
