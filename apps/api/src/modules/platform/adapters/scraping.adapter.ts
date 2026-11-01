/** Institution kinds a company can connect, matching the legacy `IntegrationType` enum. */
export type IntegrationType = 'hometax' | 'giro' | 'cardsales' | 'bank' | 'creditcard' | 'allra' | 'speedbank' | 'pg' | 'delivery'

/** How an integration authenticates against its institution. */
export type IntegrationAuthType = 'id' | 'certificate' | 'speedbank' | 'api_key' | 'oauth'

/** Decrypted certificate material handed to the scraping worker. */
export interface CertificateMaterial {
  certBlob: string
  keyBlob: string
  signPw: string
}

/** Decrypted credentials of one integration; only ever held in memory. */
export interface ScrapCredential {
  authType: IntegrationAuthType
  accountId?: string
  password?: string
  /** PG keys such as `secretKey` or `merchantKey`. */
  keys?: Record<string, string>
  certificate?: CertificateMaterial
}

/** Input of {@linkcode ScrapingAdapter.verifyCredential}. */
export interface CredentialCheck {
  type: IntegrationType
  /** Card company, bank, PG or delivery app code. */
  subCode: string | null
  isCorporate: boolean
  businessNumber: string
  credential: ScrapCredential
}

/** Outcome of a credential check. */
export type CredentialCheckResult = { ok: true } | { ok: false; code: string; message: string }

/** A card, account or store the institution reports for a credential. */
export interface ScrapCandidate {
  externalKey: string
  name: string
  /** Full card or account number; `null` for stores. */
  number: string | null
  subCode: string
  accountType?: string
  currencyCode?: string
  holder?: string
  openDate?: string
  balance?: number
}

/** Input of {@linkcode ScrapingAdapter.listCandidates}. */
export interface CandidateQuery extends CredentialCheck {
  type: 'creditcard' | 'bank' | 'delivery'
  subCode: string
}

/** One scraped record forwarded to the bookkeeping domain. */
export interface ScrapRecord {
  kind: 'sales' | 'purchase' | 'bank_transaction' | 'card_approval' | 'giro_bill'
  externalId: string
  occurredOn: string
  /** Amount in whole won; negative for cancellations and withdrawals. */
  amount: number
  description: string
}

/** Input of {@linkcode ScrapingAdapter.scrape}. */
export interface ScrapJob {
  companyId: string
  businessNumber: string
  type: IntegrationType
  subCode: string | null
  integrationId: string
  /** External key of the card, account or store, or `null` for the whole integration. */
  itemExternalKey: string | null
  credential: ScrapCredential
  options: Record<string, unknown>
  isInitial: boolean
}

/** Outcome of one scrape. */
export type ScrapOutcome =
  | { status: 'success'; records: ScrapRecord[] }
  | { status: 'fail'; code: string; message: string; isRetryable: boolean }

/** A business type (업태·종목) registered with the tax office. */
export interface BusinessTypeEntry {
  code: string
  businessType: string
  businessClass: string
  isMain: boolean
}

/** Input of {@linkcode ScrapingAdapter.joinGiro}. */
export interface GiroJoinRequest {
  certificate: CertificateMaterial
  giroId: string
  giroPw: string
  email: string
  phone: string
}

/**
 * Vendor gateway that talks to Hometax, card companies, banks, PGs, delivery
 * apps and Internet Giro.
 *
 * Candidate lookups and credential checks are synchronous calls with a 120 s
 * vendor timeout; recurring and manual collection runs through
 * {@linkcode ScrapingAdapter.scrape} from the scrap queue.
 */
export interface ScrapingAdapter {
  /** Checks that credentials log in to the institution. */
  verifyCredential(check: CredentialCheck): Promise<CredentialCheckResult>
  /** Lists the cards, accounts or stores reachable with credentials. */
  listCandidates(query: CandidateQuery): Promise<ScrapCandidate[]>
  /** Collects records for one integration or item. */
  scrape(job: ScrapJob): Promise<ScrapOutcome>
  /** Checks a certificate signing password against the private key. */
  checkCertificatePassword(material: CertificateMaterial): Promise<boolean>
  /** Signs up to Internet Giro; the Giro ID and password are never stored. */
  joinGiro(request: GiroJoinRequest): Promise<CredentialCheckResult>
  /** Reads the business types registered at Hometax. */
  fetchBusinessTypes(businessNumber: string): Promise<BusinessTypeEntry[]>
}

/** A batch of scraped records for one integration item. */
export interface ScrapBatch {
  companyId: string
  service: IntegrationType
  integrationId: string
  itemId: string | null
  requestId: string
  records: ScrapRecord[]
}

/**
 * Ingestion hook that stores scraped records in the bookkeeping domain.
 *
 * The platform domain persists only integration and scrap state; evidence,
 * bank transactions and card approvals belong to bookkeeping, which plugs its
 * writer in here.
 */
export interface ScrapResultSink {
  /** Stores a batch; throwing marks the scrap result as a retryable failure. */
  ingest(batch: ScrapBatch): Promise<void>
}
