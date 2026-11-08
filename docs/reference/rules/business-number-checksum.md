# 사업자등록번호·법인등록번호 검증

## 요약

- 사업자등록번호는 하이픈을 지운 뒤 숫자 10자리여야 하고, 국세청 가중치(1,3,7,1,3,7,1,3,5)로 검증번호(10번째 자리)를 확인합니다
- 법인등록번호는 하이픈을 지운 뒤 숫자 13자리여야 하고, 1·2 교대 가중치로 13번째 자리를 확인합니다
- 클라이언트 메시지 키는 `bizNumber`, `corpNumber`입니다. 앞뒤 공백은 지우지 않습니다

## 현행 위치

- 클라이언트: 입력 검증 메시지 `bizNumber/corpNumber/regNumber` (화면 chunk, 번들에는 메시지 키만)
- 가입: nexus `GET /api/pre-signup/check/business_number/?business_number=`
- 레거시 구현: `apps/api/legacy/src/modules/platform/platform.utils.ts`(`requireBusinessNumber`, `isValidBusinessNumber`, `isValidCorporateNumber`)

## 로직

사업자등록번호 `d0…d9`:

1. `sum = Σ d[i] × w[i]` (i = 0…8, `w = [1,3,7,1,3,7,1,3,5]`)
2. `sum += floor(d8 × 5 / 10)`
3. `(10 − sum mod 10) mod 10 === d9`

법인등록번호 `d0…d12`:

1. `sum = Σ d[i] × (i가 짝수면 1, 홀수면 2)` (i = 0…11)
2. `(10 − sum mod 10) mod 10 === d12`

## 근거

`docs/reference/spec/platform.md:161, 427`

> | `business_number` | 10자리, 체크섬 검증, 읽기 전용, UNIQUE |
>
> - 사업자번호·법인번호·주민번호 체크섬 검증(클라이언트 메시지 `bizNumber/corpNumber/regNumber`).

`apps/api/legacy/src/modules/platform/platform.utils.ts:84-92`

```ts
export function isValidBusinessNumber(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  const numbers = [...digits].map(Number)
  let sum = 0
  for (let index = 0; index < 9; index += 1) sum += (numbers[index] ?? 0) * (weights[index] ?? 0)
  sum += Math.floor(((numbers[8] ?? 0) * 5) / 10)
  return (10 - (sum % 10)) % 10 === numbers[9]
}
```

## 픽스처

[`apps/api/test/fixtures/rules/business-number-checksum.json`](../../../apps/api/test/fixtures/rules/business-number-checksum.json): 16건 (추적 16). 기대값은 레거시 함수를 node로 계산해 확인했습니다

| 케이스 | 결과 |
|---|---|
| `1238145600`, `123-81-45600`, `220-81-62517` | 유효 |
| 검증번호 틀림, 9·11자리, 문자 포함, 앞 공백 | 무효 `bizNumber` |
| `0000000000` | 유효 (검증식만 통과) |
| `110111-0000002`, `134511-0123452` | 유효 |
| 검증번호 틀림, 12·14자리 | 무효 `corpNumber` |

## 서버 이전 시 주의

- 형식 검사는 스키마(400 `VALIDATION_FAILED`, `INVALID_VALUE`)로, 사업자 상태는 사업자 상태조회 어댑터 결과로 나눕니다. 422 `BUSINESS_CLOSED`는 폐업만이고 휴업·미등록·조회 실패는 등록합니다
- `0000000000`처럼 검증식만 통과하는 값이 있습니다. 상태조회는 미등록(없는 번호)을 막지 않으므로 지금은 등록되니 테스트 데이터에 쓰지 않게 합니다
- 공백 제거를 서버가 할지 정해야 합니다. 저장은 하이픈 없는 숫자열 하나로 합니다
- 사업자번호는 회사 유일 키라 저장소 유일 제약으로 중복을 막습니다
