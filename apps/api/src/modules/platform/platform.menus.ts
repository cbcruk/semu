import type { MenuRule } from '../access/access.types'

/** Menu rules owned by the platform domain. */
export const PLATFORM_MENUS = {} as const satisfies Record<string, MenuRule>
