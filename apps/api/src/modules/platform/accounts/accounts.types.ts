import type { UserType } from '../../access/access.types'

/** Values for {@linkcode insertUser}. */
export interface NewUser {
  id: string
  email: string
  userType: UserType
  passwordHash: string | null
  name: string | null
  phone: string | null
  createdAt: string
}

/** A company the user belongs to, as listed in `GET /api/user/me/`. */
export interface MembershipSummaryRow {
  id: string
  name: string
  tax_plan: 'taxation' | null
  role: 'admin' | 'member'
  is_system_admin: 0 | 1
}

/** Purposes of rows in `one_time_tokens`. */
export type OneTimeTokenPurpose = 'signup_email' | 'password_reset' | 'social_signup'

/** A row of `one_time_tokens`. */
export interface OneTimeTokenRow {
  token_hash: string
  purpose: OneTimeTokenPurpose
  email: string
  user_id: string | null
  payload: string | null
  created_at: string
  expires_at: string
  used_at: string | null
}
