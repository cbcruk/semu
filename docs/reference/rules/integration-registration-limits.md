# 기관 연동 등록 제약

## 요약

- 카드·계좌·PG 상점(MID)·배달 매장은 회사당 유형별 **최대 20개**입니다. 목록 응답의 `maxRegister…Count: 20`이 화면 한도입니다
- PG는 PG사마다 필요한 연동키가 다르고, 비밀 키는 암호화해 저장하고 응답에서 가립니다. `CF_`로 시작하는 토스페이먼츠 MID(카페24 발급)는 받지 않습니다. 한 PG사에 단건·정기 계정이 있으면 MID별로 따로 등록합니다
- 홈택스는 ID/PW(조회만)와 인증서(세금계산서 발급까지)를 함께 둘 수 있습니다. 인터넷지로는 인증서로만 연동하고 지로 ID·비밀번호는 **저장하지 않습니다**
- 하나·롯데·삼성 법인카드는 ID/PW로만, 신한은행 세무신고용 계좌는 빠른조회 전용 계정으로만 연동합니다 (매뉴얼, 레거시 서버는 검사하지 않음)
- 이니시스·나이스페이는 PG에 대사 IP `52.78.5.241`을 미리 등록해야 합니다

## 현행 위치

- 화면: 설정 > 내역 수집 기관 연동(`/integrate/transaction`), 세무신고 기관 연동(`/integrate/tax`)
- 번들: `IntegrationType`·`PgCompany` enum(B:89170-89192), 등록 엔드포인트(B:89195-89290), `CreditCardCode`(B:90244), `BankCode`(B:89899), 목록 데모(B:90955-91060)
- 레거시 서버: `apps/api/legacy/src/modules/platform/integrations/integrations.utils.ts`(`MAX_REGISTER_COUNT`, `PG_KEYS`, `DELIVERY_CORPS`), `integrations.service.ts`(`resolveAuth`, `registerWithItems`, `registerSimple`, `registerPg`, `registerDelivery`, `assertLimit`)

## 로직

| 유형 | 인증 | 레거시 서버 검사 |
|---|---|---|
| `hometax` | ID/PW 또는 인증서 | 같은 인증 방식 연동이 이미 있으면 409. 인증서는 [certificate-eligibility](certificate-eligibility.md) |
| `cardsales` | 여신금융협회 ID/PW | 인증서 거절, 중복 409 |
| `creditcard`, `bank` | 인증서(여러 기관 일괄) 또는 ID/PW(한 기관씩) | ID/PW로 기관 코드 2개 이상이면 400. 새로 고른 항목이 없으면 400. 기존 + 추가 > 20이면 400(`items`) |
| `speedbank` | 은행 빠른조회 계정 | 같은 은행·계정 중복 409 |
| `giro` | 인증서만 | 인증서가 없으면 400(`cert_id`). 지로 가입·로그인 ID/PW는 어댑터로만 넘기고 저장하지 않음 |
| `pg` | MID + PG별 키 | 모르는 PG사 400, `TOSSPAYMENTS` + `CF_` 400, 빠진 키 400(첫 키 이름), 같은 PG사·MID 409, PG 연동 20개 이상이면 400 |
| `delivery` | 배달앱 ID/PW | 인증서 거절, 새 매장이 없으면 409, 매장 합계 > 20이면 400 |

PG별 키(`PG_KEYS`): `NICEPAY{usr_id, merchant_key}`, `TOSSPAYMENTS{secret_key}`, `TOSSPAY{api_key}`, `UPLUS{mert_key}`, `NAVERPAY{settlement_api_key, client_id, client_secret, chain_id}`, `HECTO{license_key}`, `INICIS{reconciliation_password}`, `EXIMBAY{secret_key}`, `KSNET{reconciliation_api_key}`. 모두 `mid` 필수.

## 근거

`docs/reference/spec/platform.md:99-103`

> - 카드·은행 연동 두 경로: **인증서로 여러 기관 일괄**(법인/개인 선택 → 기관 다중 체크 → 등록 인증서 선택 + 비밀번호 → 기관별 카드/계좌 체크) vs **ID/PW로 한 기관씩**(기관 + 법인/개인 → ID/PW → 목록에서 선택). 하나·롯데·삼성 **법인카드는 ID/PW만**. 신한은행은 인터넷뱅킹이 아니라 빠른조회 전용 계정.
> - **인터넷지로**: … **"아이디, 비밀번호는 혜움에서 저장하지 않습니다"**. → `POST /cert/:id/join/giro`, 이후 `POST /integrations/giro/`.
> - **PG**(이미지 a3e0aa5a): PG사 선택 → `PG상점아이디(MID)` + PG별 키. 한 PG사에 단건/정기 계정이 있으면 MID별 각각 등록. `CF_` 접두 토스 MID 불가. 최대 20개(`maxRegisterPgCount: 20`). PG별 필요 키는 2.9.

`docs/reference/spec/platform.md:276`

> `PgCompany`(B:89181): `NICEPAY{mid, usrId(상점관리자 ID), merchantKey}`, `TOSSPAYMENTS{mid, secretKey}`, … 이니시스·나이스는 **사전 IP 화이트리스트(52.78.5.241)** 등록 필요 → 재구현 시 고정 egress IP 필요.

`docs/reference/spec/platform.md:283`

> - 한도: 카드·계좌·PG·배달 각 20(`max…Count`) — 서버 검증.

`alfred-manual/08-설정/07-내역-수집-기관-연동/README.md`

> - ID/PW 로그인을 통한 연동 시에는 매출 / 매입 내역 조회만 가능하며, **인증서를 연동하면 세금계산서 발행까지 가능합니다.**
>
> - 하나/롯데/삼성 법인 카드의 경우에는 인증서 연동을 지원하지 않기 때문에, ID/PW 로그인 방식으로만 연동이 가능합니다.

`alfred-manual/08-설정/07-내역-수집-기관-연동/04-PG사-연동하기.md`

> - 하나의 PG사에서 단건결제, 정기결제 계정이 존재할 경우 각 계정의 MID 및 연동키를 각각 레포트에 연동하여야 합니다.
> - CF_로 시작하는 카페24 발급 토스페이먼츠 상점아이디는 연동 불가합니다.

`alfred-manual/08-설정/07-내역-수집-기관-연동/05-PG연동-사전-준비-연동키-확인/07-KG이니시스.md`

> 대사서비스 신청시 다음의 IP주소로 서비스 등록을 신청합니다. **IP : 52.78.5.241**

`alfred-manual/08-설정/06-세무신고-기관-연동/README.md`

> 계좌 및 계정 연동 방식은 은행별로 다를 수 있습니다. (예: 빠른조회 전용계정 연동(신한은행), 사업자번호 및 계정 ID/PW 연동(국민은행))
>
> 온라인 카드매출(PG) 매출은 연동을 지원하지 않습니다. 여신금융협회를 통한 오프라인 카드매출 내역만 연동됩니다.

`apps/api/legacy/src/modules/platform/integrations/integrations.service.ts:159-166` (발췌)

```ts
if (input.pg_company === 'TOSSPAYMENTS' && input.mid.startsWith('CF_')) throw invalidField('mid', 'MIDs starting with CF_ cannot be connected.')
const missing = spec.required.filter((key) => (input.keys[key] ?? '') === '')
if (missing.length > 0) throw invalidField(missing[0] ?? 'keys', `Enter ${missing.join(', ')}.`)
if (existing.some((row) => row.sub_code === input.pg_company && row.account_id === input.mid)) throw new DomainError('CONFLICT', 'This MID is already connected.')
if (existing.length >= MAX_REGISTER_COUNT) throw invalidField('mid', `Up to ${MAX_REGISTER_COUNT} PG accounts can be connected.`)
```

## 픽스처

[`apps/api/test/fixtures/rules/integration-registration-limits.json`](../../../apps/api/test/fixtures/rules/integration-registration-limits.json): 20건 (추적 20)

| 케이스 | 입력 | 결과 |
|---|---|---|
| 계좌 19 + 1 / 19 + 2 | | 허용 / 400 `items` |
| 카드 ID 로그인으로 카드사 2곳 | | 400 |
| 법인 하나·롯데·삼성 + 인증서 | | 불가 (매뉴얼) |
| 토스 `CF_` MID / 다른 PG `CF_` | | 400 / 허용 |
| 네이버페이 키 누락 | | 400 `client_secret` |
| 같은 PG사 두 번째 MID / 같은 MID | | 허용 / 409 |
| PG 21번째 | | 400 |
| 지로 ID/PW | | 400 `cert_id` |
| 홈택스 ID + 인증서 공존 / ID 두 번 | | 허용 / 409 |

## 서버 이전 시 주의

- 한도 20을 세는 단위가 레거시에서 갈립니다. 카드·계좌·매장은 항목 수, PG는 연동 수입니다. 비활성·삭제 항목을 셀지도 정해야 합니다
- 법인카드 ID/PW 전용, 빠른조회 전용 은행은 매뉴얼에만 있습니다. 기관 코드별 허용 인증 방식을 참조데이터로 두고 서버가 검사합니다
- PG 키 목록은 PG사가 바꾸면 따라 바꿔야 하므로 참조데이터로 둡니다. 비밀 키는 봉투 암호화하고 응답·로그에 넣지 않습니다
- 지로 ID·비밀번호는 매뉴얼이 "저장하지 않는다"고 약속했습니다. 재설계에서도 어댑터로만 넘기고 감사 로그에도 남기지 않습니다
- 레거시 등록은 수집 업체를 120초 동기 호출했습니다. 재설계는 후보 조회만 동기로 두고 첫 수집은 `Job`으로 넘깁니다
- 이니시스·나이스 대사는 고정 출구 IP가 필요합니다. 인프라 요건으로 문서화합니다

