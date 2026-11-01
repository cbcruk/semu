import type { AuthUser } from '../../../app.types'
import type { UserType } from '../../access/access.types'

/** A row of the `sessions` table; `id` is the SHA-256 of the cookie value. */
export interface SessionRow {
  id: string
  user_id: string
  csrf_token: string
  stay_signed_in: 0 | 1
  user_agent: string | null
  ip: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
}

/** A row of the `users` table including the platform columns. */
export interface UserRow {
  id: string
  email: string
  user_type: UserType
  manager_id: string | null
  password_hash: string | null
  name: string | null
  phone: string | null
  is_active: 0 | 1
  marketing_agreed: 0 | 1
  created_at: string | null
  last_login_at: string | null
}

/** Who a request authenticated as, and how. */
export interface ResolvedCredentials {
  user: AuthUser
  /** `company_id` claim of a JWT, or the company in the path for session requests. */
  tokenCompanyId: string | null
  sessionId: string | null
}

/** A freshly created session whose secrets go into cookies. */
export interface IssuedSession {
  token: string
  csrfToken: string
  staySignedIn: boolean
  expiresAt: string
}

/** Claims of the company JWT issued by `POST /api/user/me/jwt/`. */
export interface CompanyJwtClaims {
  [claim: string]: string | number
  sub: string
  company_id: string
  sf_company_id: string
  user_type: UserType
  iat: number
  exp: number
}
