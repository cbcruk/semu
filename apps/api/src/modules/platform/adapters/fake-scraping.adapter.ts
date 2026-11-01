import { createHash } from 'node:crypto'
import type {
  BusinessTypeEntry,
  CandidateQuery,
  CertificateMaterial,
  CredentialCheck,
  CredentialCheckResult,
  GiroJoinRequest,
  ScrapCandidate,
  ScrapingAdapter,
  ScrapJob,
  ScrapOutcome,
  ScrapResultSink,
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
        records: [1, 2].map((index) => ({
          kind: recordKind(job.type),
          externalId: `${job.integrationId}-${job.itemExternalKey ?? 'all'}-${index}`,
          occurredOn: '2026-10-31',
          amount: (Number.parseInt(seed.slice(index, index + 4), 16) % 900 + 100) * 1000,
          description: `${job.type} record ${index}`,
        })),
      })
    },
    checkCertificatePassword(material: CertificateMaterial): Promise<boolean> {
      return Promise.resolve(!material.signPw.startsWith(WRONG_PREFIX))
    },
    joinGiro(request: GiroJoinRequest): Promise<CredentialCheckResult> {
      if (request.giroPw.startsWith(WRONG_PREFIX)) return Promise.resolve({ ok: false, code: 'GIRO_JOIN_REJECTED', message: 'Internet Giro rejected the sign-up.' })
      return Promise.resolve({ ok: true })
    },
    fetchBusinessTypes(businessNumber: string): Promise<BusinessTypeEntry[]> {
      return Promise.resolve([
        { code: `${businessNumber.slice(0, 2)}0001`, businessType: '서비스업', businessClass: '응용 소프트웨어 개발 및 공급업', isMain: true },
        { code: `${businessNumber.slice(0, 2)}0002`, businessType: '도매 및 소매업', businessClass: '전자상거래 소매업', isMain: false },
      ])
    },
  }
}

/** Creates a {@linkcode ScrapResultSink} that drops every batch, used until bookkeeping wires its writer. */
export function createNoopScrapResultSink(): ScrapResultSink {
  return { ingest: (): Promise<void> => Promise.resolve() }
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

function recordKind(type: ScrapJob['type']): 'sales' | 'purchase' | 'bank_transaction' | 'card_approval' | 'giro_bill' {
  switch (type) {
    case 'bank':
    case 'speedbank':
      return 'bank_transaction'
    case 'creditcard':
      return 'card_approval'
    case 'giro':
      return 'giro_bill'
    case 'hometax':
      return 'purchase'
    default:
      return 'sales'
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
