# 사용자 초대 유효성과 중복

## 요약

- 사용자 초대는 **관리자만** 합니다. 관리자 초대면 권한 그룹을 저장하지 않습니다
- 초대 유효기간은 30일이고, 만료는 시각으로 파생합니다(만료 시각 정각부터 만료)
- (회사, 이메일)당 대기 중 초대는 하나입니다. 이미 멤버인 이메일은 초대할 수 없습니다. 대기 중 초대가 있으면 "취소 후 재초대"입니다
- 대기 중인 초대만 취소할 수 있고, 만료·취소 뒤에는 다시 초대할 수 있습니다
- 수락: 이미 계정이 있으면 그 이메일로 로그인해야 하고, 새 사용자는 비밀번호와 필수 가입 약관 동의가 필요합니다

## 현행 위치

- 화면: 설정 > 사용자 관리(초대 모달, 목록 탭 `전체 / 가입완료 / 초대완료 / 초대 만료`), 공개 `/join/internal?token=`
- 호출: nexus `POST/GET /api/company/:cid/internal-invitation/`, `DELETE …/:invId/`, `GET /api/internal-invitation/:token/`, `POST …/:token/accept/`
- 레거시 구현: `apps/api/legacy/src/modules/platform/invitations/invitations.service.ts`, `invitations.repository.ts`

## 로직

```
pending ──accept(미만료)──▶ accepted   (멤버십 생성 + 권한 그룹 복사)
pending ──cancel(관리자)──▶ cancelled  (이후 수락 410)
pending ──now ≥ expiresAt─▶ expired
expired | cancelled ──재초대──▶ 새 pending (새 토큰, now + 30일)
```

- 이메일은 소문자로 바꿔 비교·저장합니다. 권한 그룹 ID는 중복을 지웁니다
- 남은 일수 = `ceil((expiresAt − now) / 1일)`, 대기 중일 때만
- 목록은 `pending`과 `expired`만 보여 주고, 수락된 초대는 사용자 목록(`가입완료`)에 나옵니다
- 수락 검사 순서: 토큰 존재(404) → 대기 중(410) → 기존 사용자면 로그인(401)·이메일 일치(403), 새 사용자면 비밀번호 정책·필수 약관(400) → 이미 멤버(409)

## 근거

`docs/reference/spec/platform.md:66-71`

> - 관리자만 초대·권한 그룹 CRUD 가능. 일반 사용자는 부여된 메뉴만.
> - 목록 탭: `전체 / 가입완료 / 초대완료 / 초대 만료`. 행: 권한 배지, 이메일, 상태(`가입완료`, `초대 완료 — 유효기간 N일 남음`, `초대 만료`), 액션(`초대 취소`, 만료 시 `다시 초대하기`, 가입완료 행은 수정/삭제, 본인 행은 권한 보기). 20개씩 페이지.
> - **초대 유효기간 30일**. 취소하면 메일을 열어도 가입 불가. 초대 완료 상태에서 재초대는 "취소 후 재초대"(서버는 활성 초대 중복을 거부해야 함).

`docs/reference/spec/platform.md:348`

> - 불변식: `(company_id, lower(email))`당 `pending` 1개(부분 UNIQUE 인덱스). 이미 멤버인 이메일 초대 → 409.

`manual/08-설정/02-사용자-관리.md:18, 62, 68`

> 사용자 추가는 관리자 권한이 있는 계정만 가능합니다. 로그인 ID(이메일)는 변경할 수 없으니 자주 사용하는 메일 주소로 설정해 주세요.
>
> 초대된 사용자는 `가입 대기중` 상태로 표시됩니다. X 버튼으로 초대를 취소할 수 있으며, 30일 이내에 가입하지 않으면 초대가 만료됩니다.
>
> 초대받은 사용자는 이메일의 `초대 수락하기`를 눌러 비밀번호를 설정하고 약관에 동의한 뒤 가입을 완료합니다.

`apps/api/legacy/src/modules/platform/invitations/invitations.service.ts:94-97`

```ts
export function effectiveStatus(invitation: InvitationRow, now: string): InvitationStatus {
  if (invitation.status === 'pending' && !isBefore(now, invitation.expires_at)) return 'expired'
  return invitation.status
}
```

## 픽스처

[`apps/api/test/fixtures/rules/internal-invitation.json`](../../../apps/api/test/fixtures/rules/internal-invitation.json): 20건 (추적 20)

| 케이스 | 결과 |
|---|---|
| 새 이메일 초대 | `pending`, 소문자 이메일, +30일 |
| 관리자 초대 | 권한 그룹 비움 |
| 일반 사용자의 초대 | 403 |
| 대기 중 중복(대소문자 무시) / 기존 멤버 | 409 |
| 만료·취소 후 재초대 | 새 `pending` |
| 만료·수락된 초대 취소 | 409 `INVALID_TRANSITION` |
| 남은 일수 | 첫날 30, 마지막 23시간 1, 만료 시각 `초대 만료` |
| 목록 | `pending`·`expired`만 |
| 취소된 초대 수락 | 410 |
| 기존 사용자 비로그인 / 다른 계정 | 401 / 403 |
| 새 사용자 약관 누락 / 정상 | 400 / 멤버십 + 세션 |

## 서버 이전 시 주의

- "가입 대기중"(매뉴얼)과 "초대 완료"(스펙) 표기가 다릅니다. 서버는 `PENDING`·`ACCEPTED`·`CANCELED`·`EXPIRED`와 `expiresAt`만 주고 문구는 클라이언트가 정합니다
- 중복 금지는 저장소의 부분 유일 제약으로 보장해야 경쟁 조건이 없습니다
- 만료를 저장하지 않고 파생하면 목록 필터(`status=EXPIRED`)도 시각으로 계산해야 합니다
- 토큰은 해시만 저장하고 응답에 원문을 다시 주지 않습니다(메일로만)
- 초대 뒤 권한 그룹이 지워지면 레거시는 수락 시 조용히 빠뜨립니다
