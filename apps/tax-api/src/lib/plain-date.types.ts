/** A calendar date in `YYYY-MM-DD` form that carries no time zone. */
export type PlainDate = string & { readonly __brand: 'PlainDate' }

/** Numeric parts of a {@linkcode PlainDate}, with `month` in the range 1–12. */
export interface DateParts {
  year: number
  month: number
  day: number
}
