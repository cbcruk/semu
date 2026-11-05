# 수집 재시도 가능 여부

## 요약

- 연동 상태 화면은 연동마다 "다시 시도" 버튼을 보여 줄지 클라이언트가 판정합니다(B:91826-91900). 판정식이 연동 유형마다 다릅니다
- 인증서로 연동한 홈택스·지로·은행은 인증서가 `EXPIRED`·`INACTIVE`면 재시도할 수 없습니다. 나머지는 마지막 수집 결과(`lastScrapping.isRetryable`)를 씁니다
- 결과가 없을 때의 기본값이 유형마다 다릅니다. 홈택스·카드매출·배달·지로는 참, PG·올라는 값 그대로(없으면 거짓)입니다
- 레거시 서버는 이를 "인증서 연동이고 인증서가 `EXPIRED|INACTIVE|UNREGISTERED`면 거짓, 아니면 마지막 결과(없으면 참)" 한 식으로 줄였습니다

## 현행 위치

- 번들: `getScrappingStatus` 응답(`integrationStatus[type]`) 해석부 B:91790-91900
- 레거시 서버: `apps/api/legacy/src/modules/platform/integrations/integrations.utils.ts`의 `isRetryable`, 인증서 상태는 `certificates.utils.ts`의 `certificateStatus`

## 로직

| 유형 | 클라이언트 판정 |
|---|---|
| `hometax` | ID 연동이 없고 인증서가 `EXPIRED`/`INACTIVE`면 거짓. ID와 인증서가 함께 있으면 ID 쪽 `lastScrapping.isRetryable`. 하나만 있으면 그 값, 결과가 없으면 참 |
| `giro`, `bank` | 인증서가 `EXPIRED`/`INACTIVE`면 거짓. `bank`는 비활성 계좌(`isActive: false`)를 빼고 계좌별로 판정 |
| `cardsales`, `delivery` | `lastScrapping`이 없으면 참, 있으면 그 값 |
| `pg`, `allra` | `lastScrapping.isRetryable` 그대로. `allra`는 SCM별 |

- 클라이언트는 `UNREGISTERED`(연동은 있으나 인증서 삭제)를 막지 않습니다. 레거시 서버는 막습니다
- 레거시 서버: `auth_type === 'certificate' && status ∈ {EXPIRED, INACTIVE, UNREGISTERED}` → 거짓, 아니면 `lastStatus === undefined || lastStatus.is_retryable`

## 근거

`docs/reference/spec/platform.md:260`

> 상태 화면 `GET /integrations/status/?integration_type=` → `integrationStatus[type]` 배열. 항목: hometax `{ authType: 'ID'|'CERTIFICATE', certificate: CertificateStatus, lastScrapping: { isRetryable, … } }`, bank `{ isActive, certificate, accounts:[{ isActive, lastScrapping }] }`, creditcard `{ accounts:[…] }`, allra `{ scm:[{ lastScrapping }] }`, 나머지 `{ certificate?, lastScrapping }`(B:91790-91900). `CertificateStatus = ACTIVE | EXPIRED | INACTIVE | UNREGISTERED`.

`docs/reference/spec/platform.md:366-367`

> - 재시도 가능(`isRetryable`, 클라이언트 규칙 B:91826-91900): hometax는 ID 연동이 없고 인증서가 EXPIRED/INACTIVE면 불가, ID+인증서 둘 다면 ID 쪽 `lastScrapping.isRetryable`, 하나면 그 값(없으면 true); giro·bank는 인증서 EXPIRED/INACTIVE면 불가, bank는 비활성 계좌 제외; cardsales·delivery는 lastScrapping 없으면 true; pg·allra는 값 그대로. → 서버가 `is_retryable`를 결과에 계산해 내려준다(인증서 비밀번호 오류·계정 잠김 등은 false).
> - 인증서 상태: `UNREGISTERED`(연동은 있으나 인증서 삭제) / `ACTIVE` / `EXPIRED`(end_date 경과) / `INACTIVE`(기관에서 폐기·비밀번호 변경 감지).

`apps/api/legacy/src/modules/platform/integrations/integrations.utils.ts:133-136`

```ts
export function isRetryable(integration: IntegrationRow, certificate: CertificateStatus | null, lastStatus: ScrapResultRow | undefined): boolean {
  if (integration.auth_type === 'certificate' && (certificate === 'EXPIRED' || certificate === 'INACTIVE' || certificate === 'UNREGISTERED')) return false
  return lastStatus === undefined || lastStatus.is_retryable === 1
}
```

## 픽스처

[`apps/api/test/fixtures/rules/scrap-retryable.json`](../../../apps/api/test/fixtures/rules/scrap-retryable.json): 18건 (추적 18)

| 케이스 | 입력 | 결과 |
|---|---|---|
| 홈택스 ID만, 결과 없음 | | 참 |
| 홈택스 인증서만, `EXPIRED`/`INACTIVE` | | 거짓 |
| 홈택스 인증서만, `UNREGISTERED` | | 참 (클라이언트는 검사 안 함) |
| 홈택스 ID + 만료 인증서 | ID 결과 참 | 참 |
| 은행, 비활성 계좌 섞임 | | 활성 계좌만 |
| PG, 결과 없음 | | 거짓 (클라이언트) / 참 (레거시 서버) |
| 서버, 인증서 연동 + `UNREGISTERED` | | 거짓 |

## 서버 이전 시 주의

- 재설계에서는 서버가 연동마다 `allowedActions`에 `RETRY`를 넣을지 계산합니다. 클라이언트 판정식은 없앱니다
- 유형마다 다른 기본값(결과 없음 → 참/거짓)을 하나로 맞춰야 합니다. 수집한 적 없는 연동은 재시도가 아니라 첫 수집 대상입니다
- `UNREGISTERED` 인증서는 막는 쪽이 맞아 보입니다. 인증서가 없으면 수집이 반드시 실패합니다
- 홈택스 ID + 인증서 조합에서 인증서 쪽 오류가 화면에 드러나지 않습니다. 연동별로 따로 상태를 줍니다
- 어떤 수집 오류가 재시도 불가인지(비밀번호 오류, 계정 잠김, 미가입·폐업 사업자)는 수집 어댑터가 오류 코드를 분류해 정합니다

