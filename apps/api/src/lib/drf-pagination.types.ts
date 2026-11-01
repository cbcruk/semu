/** A Django REST Framework style page envelope. */
export interface Page<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

/** Limit and offset parsed from query parameters. */
export interface PageRequest {
  limit: number
  offset: number
}
