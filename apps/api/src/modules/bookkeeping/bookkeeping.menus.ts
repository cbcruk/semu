import type { MenuRule } from '../access/access.types'

/** Menu rules owned by the bookkeeping domain. */
export const BOOKKEEPING_MENUS = {} as const satisfies Record<string, MenuRule>
