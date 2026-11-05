# 규칙 결정

> **상태: 초안 (가정 포함, 2026-11-05).** 규칙 68개의 열린 질문 233개 모두 권장안을 결정으로 채택했습니다. 보류 44개는 세법·고시·외부 서비스 값을 확인할 때까지 현행 동작을 임시 결정으로 둡니다.

현행 클라이언트 규칙의 열린 질문에 대한 서버 결정입니다. 근거 자료는 [규칙 문서](../../reference/rules/README.md)와 픽스처(`apps/api/test/fixtures/rules/`), 이 폴더 위의 재설계 문서입니다. 컨텍스트마다 파일 하나를 둡니다.

## 읽는 법

- **따름:** 현행 동작을 서버가 그대로 재현합니다. 해당 픽스처 케이스를 그대로 서버 테스트로 씁니다
- **바꿈:** 현행이 버그이거나 화면마다 달라서 서버가 다르게 동작합니다. 영향받는 케이스는 각 규칙의 **바뀌는 케이스**에 있고, 서버 테스트에서는 기대값을 바꿔 씁니다
- **보류:** 외부 사실(세법·고시, 외부 서비스 동작 등)을 확인해야 정할 수 있습니다. 확인 전까지 현행 동작을 임시 결정으로 두고, 해당 케이스는 현행 기대값 그대로 서버 테스트로 옮깁니다
- 질문 번호는 픽스처 `openQuestions` 순서입니다

## 요약

| 컨텍스트 | 문서 | 규칙 | 질문 | 따름 | 바꿈 | 보류 |
|---|---|---:|---:|---:|---:|---:|
| Identity & Access | [identity-access.md](identity-access.md) | 6 | 32 | 15 | 12 | 5 |
| Billing | [billing.md](billing.md) | 2 | 11 | 2 | 4 | 5 |
| Integrations | [integrations.md](integrations.md) | 5 | 28 | 10 | 11 | 7 |
| Assistant | [assistant.md](assistant.md) | 2 | 11 | 2 | 7 | 2 |
| Tax | [tax.md](tax.md) | 7 | 41 | 24 | 15 | 2 |
| HR | [hr.md](hr.md) | 13 | 34 | 20 | 6 | 8 |
| Documents | [documents.md](documents.md) | 5 | 13 | 8 | 4 | 1 |
| Payroll | [payroll.md](payroll.md) | 14 | 34 | 19 | 7 | 8 |
| Bookkeeping | [bookkeeping.md](bookkeeping.md) | 14 | 29 | 11 | 12 | 6 |
| | **합계** | **68** | **233** | **111** | **78** | **44** |
