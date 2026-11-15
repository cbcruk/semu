# 공동인증서 등록·사용 가능 여부

## 요약

- 공동인증서는 로컬 프로그램(InfoTech ExAdapter / iftNxService, Windows 10·11 전용)이 읽어 암호화한 뒤 서버에 올립니다
- **등록:** 개인사업자는 사업자 명의 범용·전자세금용 또는 대표자 개인 명의 은행용·범용, 법인은 법인 명의 은행용·범용·전자세금용만 받습니다. 사업자번호나 대표자 이름이 맞지 않으면 "등록할 수 없는 인증서"입니다
- **사용:** 홈택스는 사업자 범용·전자세금용만, 인터넷지로·은행·카드사는 법인이면 사업자 은행용·범용, 개인사업자면 대표자 개인 은행용·범용만 씁니다. 연동 화면은 맞지 않는 인증서를 회색 `불가`로 보여 줍니다
- **상태:** `ACTIVE | EXPIRED | INACTIVE | UNREGISTERED`. `EXPIRED`는 만료일로 파생합니다
- 세무신고 기관 연동은 인증서 연동 내역을 쓰지 못합니다. ID/PW나 빠른조회 연동만 세무사 프로그램으로 넘어갑니다

## 현행 위치

- 화면: 설정 > 공동 인증서 관리(`/manage/cert`), 내역 수집 기관 연동의 인증서 선택 단계
- 번들: 인증서 OID 분류표 B:89563-89740, `Cert` 형태 B:89743-89768
- 레거시 서버: `apps/api/legacy/src/modules/platform/integrations/certificates.utils.ts`(`CERT_OIDS`, `certificateStatus`, `isCertAllowedFor`, `serializeCertificate`), `certificates.service.ts`(`registerCertificate`, `assertOwner`)

## 로직

- 등록(`registerCertificate`) 검사 순서
  1. OID가 분류표에 없으면 400(`oid`)
  2. 만료일 < 오늘이면 400(`end_date`)
  3. 명의: 사업자 인증서는 `ownerBusinessNumber`(하이픈 제거)가 회사 사업자번호와 같아야 함. 개인 인증서는 법인이면 거절, 개인사업자면 `ownerName`이 등록된 대표자 이름 중 하나여야 함
  4. 같은 일련번호가 이미 있으면 409
  5. 서명 비밀번호 확인 실패면 400(`sign_pw`)
- 사용(`isCertAllowedFor`)
  - `hometax`: `certType === 'business' && usage ∈ {general, etax}`
  - `giro`, `bank`, `creditcard`: `certType === (법인 ? 'business' : 'personal') && usage ∈ {bank, general}`
  - 그 밖(`cardsales`, `pg`, `delivery`, `speedbank`, `allra`): 인증서 자체를 받지 않음
- 상태: 삭제됐으면 `UNREGISTERED`, `endDate < today`면 `EXPIRED`, 아니면 저장값(`ACTIVE`/`INACTIVE`). `remainingDays = round(endDate − today)`
- 표시: `구분 = (개인|사업자)(범용|은행/카드/보험용|전자세금용)`, 발급기관 이름은 `yessign → 금융결제원` 등

## 근거

`docs/reference/spec/platform.md:107-110`

> - `/manage/cert`. 등록에 **로컬 프로그램(InfoTech ExAdapter / iftNxService, Windows 10/11 전용)** 필요. 브라우저 → 로컬 에이전트가 NPKI 인증서를 읽어 암호화 → 서버에 업로드(추정: `POST /cert/` body는 에이전트 산출물).
> - 허용 인증서: 개인사업자 = 사업자 명의 범용·전자세금용 또는 개인(대표자) 명의 은행용·범용; 법인 = 법인 명의 은행용·범용·전자세금용. **로그인 사업자/대표자 명의와 불일치하면 등록 불가**.
> - 기관별 허용 종류(이미지 1aa04890): 홈택스 = 사업자 범용, 사업자 전자세금용(개인 인증서 불가); 인터넷지로·은행·카드사 = 법인(사업자 은행용, 사업자 범용) / 개인(개인 은행용, 개인 범용 — 지로는 대표자 명의 필수). 은행·카드는 해당 기관 계정에 등록된 인증서여야 함. 발급기관: yessign, signkorea, signgate, crosscert(+KICA, tradesign: OID 목록 B:89563).

`docs/reference/spec/platform.md:93`

> 세무사 프로그램 연동용이라 **인증서 연동 내역은 세무신고에 못 씀**.

`docs/reference/spec/platform.md:428`

> - 인증서 명의 일치: 개인 = 로그인 사업자 또는 대표자 명의, 법인 = 법인 명의. 기관별 허용 `usage`(1.9) 위반 → 422 `CERT_NOT_ALLOWED_FOR_SERVICE`.

`manual/08-설정/08-공동-인증서-관리.md`

> - **개인사업자** : 사업자 명의의 범용·전자세금용 인증서, 또는 개인 명의의 은행용·범용 인증서
> - **법인사업자** : 법인 명의의 은행용·범용·전자세금용 인증서
>
> 등록하려는 사업자와 일치하는 정보의 인증서인지 확인해 주세요. 개인사업자는 로그인한 사업자 또는 대표자 명의, 법인사업자는 로그인한 법인 명의의 인증서여야 합니다.

`manual/15-공동인증서-등록-연동에-실패-가이드-FAQ.md`

> 연동하려는 기관에 따라서 연동 가능한 공동인증서 종류가 다릅니다. 연동하시려는 기관과 공동 인증서의 구분을 확인해주세요.
>
> 윈도우 10, 11만 지원합니다. (맥(Mac OS)은 지원하지 않습니다.)
>
> 인증서가 만료된 경우 인증서 프로그램 상에서 표시되지 않습니다.

`manual/08-설정/07-내역-수집-기관-연동/03-인터넷지로-연동하기.md`

> 연동 항목에서 `가능` 이라고 노출되는 인증서만 연동이 가능합니다.
>
> - 개인사업자: 개인 대표자 명의의 은행용 혹은 범용 공동인증서
> - 법인사업자: 법인 명의의 은행용 혹은 범용 공동인증서

`manual/08-설정/06-세무신고-기관-연동/README.md`

> 세무신고를 위해 내역을 수집하는 경우, ID/PW 연동(또는 빠른조회 연동)을 통해 수집한 내역만 사용할 수 있습니다.

`apps/api/legacy/src/modules/platform/integrations/certificates.utils.ts:59-66`

```ts
if (service === 'hometax') return cert.cert_type === 'business' && (cert.usage === 'general' || cert.usage === 'etax')
if (service === 'giro' || service === 'bank' || service === 'creditcard') {
  const owner = businessType === 'corporate' ? 'business' : 'personal'
  return cert.cert_type === owner && (cert.usage === 'bank' || cert.usage === 'general')
}
return false
```

## 픽스처

[`apps/api/test/fixtures/rules/certificate-eligibility.json`](../../../apps/api/test/fixtures/rules/certificate-eligibility.json): 20건 (추적 20)

| 케이스 | 입력 | 결과 |
|---|---|---|
| 개인사업자, 사업자 범용 | 사업자번호 일치 | 등록 |
| 개인사업자, 다른 사람 개인 인증서 | | 거절(`owner_name`) |
| 법인, 개인 인증서 | | 거절(`oid`) |
| 만료 / 모르는 OID | | 거절 |
| 홈택스 + 사업자 전자세금용 | | 허용 |
| 홈택스 + 개인 인증서 | | `CERT_NOT_ALLOWED_FOR_SERVICE` |
| 지로 + 개인사업자 사업자 범용 | | 거절 (대표자 명의 필수) |
| 카드사 + 법인 전자세금용 | | 거절 |
| 상태: 만료일 지남 / 오늘 / 삭제 | | `EXPIRED` / `ACTIVE` / `UNREGISTERED` |

## 서버 이전 시 주의

- OID 표가 번들 표의 일부입니다. KICA·tradesign과 일부 용도가 빠져 있어 정상 인증서를 거절할 수 있습니다. 표는 코드 상수가 아니라 참조데이터로 둡니다
- 법인 전자세금용은 등록은 되지만 홈택스 외에는 쓸 곳이 없습니다. 등록 단계에서 용도를 검사할지 정해야 합니다
- 개인 인증서 명의 확인이 대표자 이름 문자열 비교입니다. 동명이인·개명을 처리하지 않습니다
- `INACTIVE`(폐기·비밀번호 변경)를 언제 감지하는지 알 수 없습니다. 수집 실패 결과로 갱신하는 것으로 추정합니다
- 지로는 인증서가 인터넷지로 계정에 등록돼 있어야 하고, 다른 사업장 지로 계정에 묶인 인증서는 실패합니다. 사전 검사할 수 없으므로 연동 시도 결과로 알려야 합니다
- 인증서 원문·개인키·서명 비밀번호는 수집 워커 경계 안에서만 복호화합니다

