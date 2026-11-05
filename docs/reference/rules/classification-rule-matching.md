# 자동분류 규칙 매칭

## 요약

- 규칙은 원천 제한(`source`)과 조건 N개를 가지고, 모든 조건이 맞아야(AND) 행에 맞습니다
- 금액 조건은 절댓값으로 비교하고, 글자 조건은 대소문자를 가리지 않습니다. 값이 없는 필드는 맞지 않습니다
- 규칙 범위(매출·매입·입출금)마다 쓸 수 있는 필드와 연산자가 정해져 있고, 저장 전에 검사합니다

## 현행 위치

- 검증·매칭: `apps/api/legacy/src/modules/bookkeeping/classification/classification.utils.ts:19-139`
- 증빙 사실(facts): `apps/api/legacy/src/modules/bookkeeping/evidence/evidence.utils.ts:32-50`
- 입출금 사실: `apps/api/legacy/src/modules/bookkeeping/bank/bank.utils.ts:53-`

## 로직

- 필드와 연산자

  | 범위 | 필드 | 연산자 |
  | --- | --- | --- |
  | 매출·매입 | 거래처 | `IN` |
  | | 상대방(이름 + 사업자번호) | `CONTAINS`, `EQUALS` |
  | | 품목 | `STARTS_WITH`, `CONTAINS`, `EQUALS` |
  | | 합계·공급가액·세액 | `GTE`, `LTE`, `BETWEEN` |
  | | 원천 | `IN` |
  | 입출금 | 적요 | `STARTS_WITH`, `CONTAINS`, `EQUALS` |
  | | 금액 | `GTE`, `LTE`, `BETWEEN` |
  | | 계좌, 거래처 | `IN` |
  | | 구분(입금·출금) | `EQUALS` |

- 검증 위반 코드: `CONDITIONS_EMPTY`(조건 없음, `index = -1`), `FIELD_NOT_ALLOWED`, `OPERATOR_NOT_ALLOWED`, `OPERAND_REQUIRED`(금액 연산자의 `min`/`max` 또는 글자 연산자의 `values`), `RANGE_REVERSED`(`min > max`)
- 매칭
  - `rule.source`가 있으면 행의 원천과 같아야 합니다
  - 금액: `|값| ≥ min`, `|값| ≤ max`, `min ≤ |값| ≤ max` (양 끝 포함)
  - 글자: 소문자로 바꿔 비교합니다. `IN`은 값 목록 중 하나와 같으면 맞습니다
  - 상대방 글자는 `${이름} ${사업자번호}`.trim()입니다. 사업자번호로도 맞출 수 있습니다
- 우선순위 순으로 처음 맞는 규칙 하나만 씁니다. 숨긴 규칙은 뺍니다

## 근거

- 스펙 `docs/reference/spec/bookkeeping.md:173-179`
  > **구성**: 이름, "이런 거래면"(조건 N개, AND로 결합), "이렇게 처리해요"(결과: 계정과목 그리고/또는 거래처)입니다.
  >
  > **우선순위**: 드래그로 순서를 바꿉니다. 위에서부터 **처음 매칭되는 규칙 하나**만 적용한다고 추정합니다.
- 매뉴얼 `alfred-manual/03-경리/01-매출-증빙-관리/01-경리-규칙기반-자동분류.md`의 조건 화면(거래처 포함, 품목으로 시작, 금액 이상·범위)

## 서버 이전 시 주의

- 현행은 첫 위반 하나를 문장으로 돌려줬습니다. 재설계는 422 `violations`에 모두 담습니다
- 금액 절댓값 비교 때문에 취소(음수) 거래도 같은 규칙에 걸립니다. 취소분만 다르게 분류하려면 원천·품목 조건을 써야 합니다
- 입출금 결과 계정은 입금·출금 범위에서 고를 수 있어야 하고, 규칙의 `source`는 그 범위 원천만 받습니다

## 픽스처

`apps/api/test/fixtures/rules/classification-rule-matching.json` (12케이스, `src/modules/bookkeeping/bookkeeping-rules.fixtures.test.ts`)
