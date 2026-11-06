import { describe, expect, it } from 'vitest'
import { normalizeEmail } from '../accounts/user.ts'
import { decideAccess } from '../authorization.ts'
import { BASE_PERMISSIONS, permissionsForLegacyMenus } from '../permissions/permission-catalog.ts'
import { testActor } from '../testing.ts'
import type { GrantedPermission } from '../actor.types.ts'
import { loadRuleCases } from '../rule-fixtures.ts'
import {
  allowedInvitationActions,
  INVITATION_TTL_DAYS,
  invitationClosedReason,
  invitationConflict,
  invitationStatus,
  remainingDays,
} from './invitation-status.ts'
import type { StoredInvitationStatus } from './invitation-status.types.ts'

/** 수락은 계정·세션·약관을 함께 다뤄 `invitations.http.test.ts`가 확인합니다. */
const NOT_PORTED = new Set([
  'accept a cancelled invitation',
  'existing user accepts without signing in',
  'existing user signed in as someone else',
  'new user without the required signup terms',
  'new user accepts with password and terms',
])

/**
 * 기대값을 바꾼 케이스입니다.
 *
 * - 닫힌 초대 취소는 수락과 같은 410 `INVITATION_CLOSED`입니다
 * - 목록은 취소·수락된 초대도 상태와 함께 돌려줍니다. 화면이 상태로 거릅니다
 */
const CHANGED: Record<string, unknown> = {
  'cancel an invitation that expired by time': { status: 410, code: 'INVITATION_CLOSED', reason: 'INVITATION_EXPIRED' },
  'cancel an accepted invitation': { status: 410, code: 'INVITATION_CLOSED', reason: 'INVITATION_ALREADY_ACCEPTED' },
  'invitation list leaves out cancelled and accepted rows': ['i1', 'i2', 'i3', 'i4'],
}

const STORED: Record<string, StoredInvitationStatus> = {
  pending: 'PENDING',
  accepted: 'ACCEPTED',
  cancelled: 'CANCELED',
  expired: 'PENDING',
}
const ACTION_LABEL = { CANCEL: '취소하기', REINVITE: '다시 초대하기' } as const
const DAY_MS = 86_400_000

interface LegacyInvitation {
  email?: string
  status: string
  expiresAt: string
}

function stored(invitation: LegacyInvitation): StoredInvitationStatus {
  return STORED[invitation.status] ?? 'PENDING'
}

function run(input: Record<string, unknown>): unknown {
  const now = Date.parse(String(input['now']))
  switch (input['check']) {
    case 'create': {
      const inviter = input['inviter'] as { isAdmin: boolean; roleMenuCodes?: string[] }
      const permissions = new Set<GrantedPermission>(
        inviter.isAdmin ? ['*'] : [...BASE_PERMISSIONS, ...permissionsForLegacyMenus(inviter.roleMenuCodes ?? [])],
      )
      if (decideAccess(testActor({ permissions }), { permission: 'invitation:create' }) !== undefined) {
        return { status: 403, code: 'PERMISSION_DENIED' }
      }
      const email = normalizeEmail(input['email'] as string)
      const existing = input['existing'] as { members: string[]; invitations: LegacyInvitation[] }
      const sameEmail = existing.invitations.filter((i) => normalizeEmail(i.email ?? '') === email)
      const conflict = invitationConflict({
        isMember: existing.members.map(normalizeEmail).includes(email),
        statuses: sameEmail.map((i) => invitationStatus(stored(i), i.expiresAt, now)),
      })
      if (conflict !== undefined) return { status: 409, code: 'CONFLICT' }
      const isAdmin = input['isAdmin'] as boolean
      const previous = sameEmail.at(-1)
      return {
        ...(previous === undefined
          ? {}
          : { previous: invitationStatus(stored(previous), previous.expiresAt, now).toLowerCase() }),
        status: 'pending',
        email,
        isAdmin,
        roleIds: isAdmin ? [] : [...new Set(input['roleIds'] as string[])],
        expiresAt: now + INVITATION_TTL_DAYS * DAY_MS,
        mail: 'internal_invitation',
      }
    }
    case 'cancel': {
      const invitation = input['invitation'] as LegacyInvitation
      const reason = invitationClosedReason(invitationStatus(stored(invitation), invitation.expiresAt, now))
      return reason === undefined ? { status: 'cancelled' } : { status: 410, code: 'INVITATION_CLOSED', reason }
    }
    case 'display': {
      const invitation = input['invitation'] as LegacyInvitation
      const status = invitationStatus(stored(invitation), invitation.expiresAt, now)
      const actions = allowedInvitationActions(status).filter((action) => action === 'REINVITE')
      return {
        status: status.toLowerCase(),
        remainingDays: status === 'PENDING' ? remainingDays(invitation.expiresAt, now) : null,
        ...(actions.length > 0 ? { actions: actions.map((action) => ACTION_LABEL[action]) } : {}),
      }
    }
    case 'list':
      return (input['invitations'] as Array<{ id: string }>).map((invitation) => invitation.id)
    default:
      throw new Error(`unknown check ${String(input['check'])}`)
  }
}

/** 기대값에서 화면 문구(`label`)를 빼고, 시각 문자열은 epoch로 바꿔 시간대 표기 차이를 없앱니다. */
function comparable(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value)
  if (Array.isArray(value)) return value.map(comparable)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'label')
        .map(([key, entry]) => [key, comparable(entry)]),
    )
  }
  return value
}

describe('internal-invitation fixtures', () => {
  for (const testCase of loadRuleCases('internal-invitation')) {
    it.skipIf(NOT_PORTED.has(testCase.name))(testCase.name, () => {
      const expected = comparable(CHANGED[testCase.name] ?? testCase.expected)
      const actual = comparable(run(testCase.input))
      if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
        expect(actual).toMatchObject(expected)
      } else {
        expect(actual).toEqual(expected)
      }
    })
  }
})
