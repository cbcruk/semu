import type { Page, PageRequest } from './drf-pagination.types'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

/** Parses `limit` and `offset` query parameters, clamping them to safe bounds. */
export function parsePageRequest(limit: string | undefined, offset: string | undefined): PageRequest {
  const parsedLimit = Number.parseInt(limit ?? '', 10)
  const parsedOffset = Number.parseInt(offset ?? '', 10)
  return {
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0,
  }
}

/**
 * Wraps results in a DRF page envelope with absolute `next` and `previous` links.
 *
 * @param requestUrl The URL of the current request, used to build the links.
 */
export function toPage<T>(results: T[], count: number, request: PageRequest, requestUrl: string): Page<T> {
  const link = (offset: number): string => {
    const url = new URL(requestUrl)
    url.searchParams.set('limit', String(request.limit))
    url.searchParams.set('offset', String(offset))
    return url.toString()
  }
  const nextOffset = request.offset + request.limit
  return {
    count,
    next: nextOffset < count ? link(nextOffset) : null,
    previous: request.offset > 0 ? link(Math.max(0, request.offset - request.limit)) : null,
    results,
  }
}
