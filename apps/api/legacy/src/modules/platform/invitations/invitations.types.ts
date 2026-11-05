/** Stored states of an internal invitation; `expired` is also derived on read once `expires_at` passes. */
export type InvitationStatus = 'pending' | 'accepted' | 'cancelled' | 'expired'

/** A row of `internal_invitations`. */
export interface InvitationRow {
  id: string
  company_id: string
  email: string
  token_hash: string
  is_admin: 0 | 1
  role_ids: string
  status: InvitationStatus
  invited_by: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  accepted_user_id: string | null
  cancelled_at: string | null
}

/** Input of {@linkcode createInvitation}. */
export interface InvitationInput {
  email: string
  is_admin: boolean
  role_ids: string[]
}

/** Body of `POST /api/internal-invitation/:token/accept/` for users without an account. */
export interface AcceptInput {
  password?: string | undefined
  confirm_password?: string | undefined
  name?: string | undefined
  agreements?: { term_id?: number | undefined; code?: string | undefined; is_agreed: boolean }[] | undefined
}
