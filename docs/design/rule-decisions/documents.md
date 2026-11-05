# 문서 규칙 결정

문서(전자서명·제증명) 규칙 5개의 열린 질문 13개에 대한 서버 결정입니다. 설계는 [documents.md](../documents.md)에 있습니다. 읽는 법은 [README](README.md)를 따릅니다.

> **상태: 결정됨 (가정 포함, 2026-11-05).**

## 요약

| 영역 | 규칙 | 질문 | 따름 | 바꿈 | 보류 |
|---|---|---:|---:|---:|---:|
| 전자서명 | [esign-request-transitions](#esign-request-transitions) | 3 | 1 | 2 | 0 |
| 전자서명 | [esign-send-validation](#esign-send-validation) | 3 | 2 | 1 | 0 |
| 전자서명 | [esign-identity-verification](#esign-identity-verification) | 2 | 2 | 0 | 0 |
| 제증명 | [certificate-issuance](#certificate-issuance) | 3 | 2 | 1 | 0 |
| 설정 | [esign-settings-limits](#esign-settings-limits) | 2 | 2 | 0 | 0 |
| | **합계** | **13** | **9** | **4** | **0** |

## 전자서명

### esign-request-transitions

[규칙 문서](../../reference/rules/esign-request-transitions.md) · 케이스 17 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 닫힌 요청을 바로 재발송할까요 | **바꿈:** `CANCELED`·`EXPIRED`·`SEND_FAILED`에서 `:resend`로 `PENDING`이 됩니다. 기한은 새로 잡고 실패 횟수·세션을 지웁니다 | 되돌리기 + 발송 두 번의 요청을 하나로 줄입니다. `:revert-to-draft`는 내용을 고칠 때 씁니다 ([커맨드](../documents.md#엔드포인트)) |
| 2 | 무효 후 되살리기를 둘까요 | **따름:** 없습니다. 새 요청을 만듭니다 | 완료 문서는 서명 증거라 상태를 되돌리지 않습니다 |
| 3 | 만료를 스케줄러로 옮길까요 | **바꿈:** 조회할 때 `isOverdue`로 만료를 반영하고, 스케줄러가 저장합니다 | 배치가 늦어도 화면이 정확합니다 |

**바뀌는 케이스:**
- `expired resend`: `ESIGN_REQUEST_TRANSITION_INVALID` → `PENDING`
- `send failed resend`: `ESIGN_REQUEST_TRANSITION_INVALID` → `PENDING`

### esign-send-validation

[규칙 문서](../../reference/rules/esign-send-validation.md) · 케이스 11 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 위반을 모두 돌려줄까요 | **바꿈:** 422 `violations`에 모두 담습니다 | 첫 위반은 현행과 같아 픽스처 기대값은 바뀌지 않습니다 |
| 2 | 문서별 기본 도장을 따로 찍을까요 | **따름:** 요청당 도장 하나입니다 | 현행과 같습니다 |
| 3 | 직원이 아닌 수신자의 원천 필드를 어떻게 할까요 | **따름:** 비어 있으면 거절합니다. 관리자가 값을 넣습니다 | 원천 값은 `HrDirectory`에서만 옵니다 |

### esign-identity-verification

[규칙 문서](../../reference/rules/esign-identity-verification.md) · 케이스 8 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 잠금 해제 커맨드를 둘까요 | **따름:** `:resend`가 실패 횟수를 0으로 되돌립니다. 따로 두지 않습니다 | 재발송은 새 링크와 같은 효과입니다 |
| 2 | 휴대폰 본인인증으로 바꿀까요 | **따름:** `SignerIdentityVerifier` 포트 뒤에 이름·생년월일 비교를 둡니다. 휴대폰 본인인증은 인증 서비스 계약이 생기면 같은 포트의 다른 구현으로 더합니다 | 법은 특정 인증 방식을 요구하지 않습니다. 전자서명은 전자적 형태라는 이유로 효력이 부인되지 않고, 당사자 간 약정으로 고른 전자서명은 서명·기명날인의 효력을 가집니다([전자서명법 제3조](https://www.law.go.kr/법령/전자서명법)) |

## 제증명

### certificate-issuance

[규칙 문서](../../reference/rules/certificate-issuance.md) · 케이스 9 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 지우지 않고 무효로 남길까요 | **바꿈:** `DELETE` 대신 `:void`입니다. `ISSUED`·`SENT`·`SEND_FAILED`에서만 되고, 발송 중에는 409입니다 | 발급대장의 번호가 비지 않게 합니다. 현행은 마지막 번호를 지우면 그 번호를 다시 씁니다 |
| 2 | 무효 번호를 다시 쓸까요 | **따름(결정 1과 함께):** 다시 쓰지 않습니다 | 번호는 무효 증명서도 셉니다 |
| 3 | 링크 유효기간을 설정으로 둘까요 | **따름:** 30일 상수 | 현행과 같습니다 |

**바뀌는 케이스:**
- `remove while sending`: 삭제됨 → `CERTIFICATE_TRANSITION_INVALID`

## 설정

### esign-settings-limits

[규칙 문서](../../reference/rules/esign-settings-limits.md) · 케이스 6 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 지운 도장 파일을 보관할까요 | **따름:** 소프트 삭제하고 파일은 남깁니다 | 완료 문서가 그 도장을 가리킵니다 |
| 2 | 대표자 연락처를 포트로 읽을까요 | **따름:** `DocumentNotifier`가 수신자가 없을 때 대표자에게 보냅니다 | 회사 정보는 플랫폼 컨텍스트 소유입니다 |
