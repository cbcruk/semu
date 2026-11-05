import type { ServiceDeps } from '../../../app.types'
import type { ScrapResultSink } from '../../platform/adapters/scraping.adapter'
import { ingestScrapedRecords } from './ingest-scraped-records'

/**
 * Creates the {@linkcode ScrapResultSink} that stores platform scrap batches in the bookkeeping tables.
 *
 * Records the ingestion rejects (unknown accounts, malformed dates) are
 * dropped rather than failing the whole scrape, matching
 * {@linkcode ingestScrapedRecords}.
 */
export function createBookkeepingScrapResultSink(deps: Pick<ServiceDeps, 'db' | 'cipher' | 'clock'>): ScrapResultSink {
  return {
    ingest(batch): Promise<void> {
      ingestScrapedRecords(deps.db, batch.companyId, batch.records, { now: deps.clock.now(), cipher: deps.cipher })
      return Promise.resolve()
    },
  }
}
