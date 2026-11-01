import type { UserType } from './access.types'

/** Named values of the legacy `UserType` enum. */
export const USER_TYPE = {
  client: 0,
  agencyMember: 1,
  agencyManager: 2,
  admin: 3,
  bot: 4,
  laborAgent: 51,
  demoClient: 99,
} as const satisfies Record<string, UserType>

/** Checks whether a user type belongs to tax agency staff. */
export function isAgencyUser(userType: UserType): boolean {
  return userType === USER_TYPE.agencyMember || userType === USER_TYPE.agencyManager
}
