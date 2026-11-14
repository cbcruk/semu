# semu

세무·인사·급여·경리 SaaS의 백엔드 API 서버입니다. 개요·명령·구조는 [README.md](README.md)에 있습니다. 서버 코드는 `apps/api/`이고 명령은 그 폴더에서 돌립니다(`pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm test:sqlite`).

## 읽을 문서

- **업무 규칙·상태 전이·오류 코드를 바꿀 때:** 그 컨텍스트의 설계 문서(`docs/design/<컨텍스트>.md`). 목록은 [docs/design/README.md](docs/design/README.md)
- **컨텍스트 사이 이벤트·outbox 소비자를 더하거나 바꿀 때:** [events.md](docs/design/events.md), 상태가 컨텍스트를 건너가는 흐름은 [lifecycles.md](docs/design/lifecycles.md)
- **경로·필드·오류·멱등성·동시성, 코드 구조와 용어(한글 식별자)를 정할 때:** [conventions.md](docs/design/conventions.md)
- **규칙 계산 모듈을 고칠 때:** 짝인 규칙 문서(`docs/reference/rules/<규칙>.md`)와 픽스처(`apps/api/test/fixtures/rules/`), 규칙 결정(`docs/design/rule-decisions/<컨텍스트>.md`)
- **이미 내린 결정과 되돌릴 조건:** [review.md](docs/design/review.md)의 결정 표와 각 설계 문서의 "정함" 항목

## 규약

- 순수 규칙(상태 전이표, 세액·보험료·기한 계산, 판정)은 Effect에 의존하지 않는 규칙 파일에 둡니다. 서비스(`<resources>.ts`)는 읽기 → 권한 → 규칙 호출 → 저장만 합니다. 요청 하나가 트랜잭션 하나이고 다른 컨텍스트에는 outbox 이벤트로 전합니다([conventions.md](docs/design/conventions.md#코드-구조))
- 다른 컨텍스트의 저장소를 직접 읽지 않습니다. 포트와 `<context>.public.ts`, `src/wiring/` 어댑터로 잇습니다
- 문서, 테스트 설명(`describe`·`it`), 이슈, PR, 리뷰는 한국어입니다. 식별자, HTTP 필드, 오류 코드, 이벤트 타입, 표 이름, 파일 이름은 영어입니다. 한글 식별자는 규칙 계산 모듈 안의 내보내지 않는 이름에만 씁니다. 테스트와 `*.testing.ts`에는 쓰지 않습니다
- 비율은 ppm 정수로 두고 이름 끝에 `Ppm`을 붙입니다. 금액은 원 단위 정수입니다
- 제품 이름은 semu입니다. 현행 서비스의 브랜드 이름을 코드·문서에 새로 쓰지 않습니다(바깥 자료 인용은 그대로 둡니다)
- 동작을 바꾸면 같은 PR에서 그 컨텍스트 문서를 고칩니다. 상태 표의 "구현 상태"와 오류 코드 표도 함께 고칩니다
- 작업은 접두사 붙은 브랜치(`feat/`, `fix/`, `refactor/`, `docs/`, `ci/`)에서 하고 `main`으로 PR을 엽니다. 커밋 메시지는 `feat(hr): …`처럼 범위를 붙인 한국어입니다. PR 본문은 바뀐 것, 하지 않은 것, 확인한 것이고 이슈를 닫으면 `Closes #N`, 일부만 하면 `Refs #N`을 적습니다

## PR 리뷰

리뷰는 연결된 이슈가 요구한 것과 위 문서들을 기준으로 봅니다. 지적마다 **막음** 또는 **후속**을 붙입니다.

- **막음:** 버그, 세액·급여·장부 금액이 틀리거나 기록이 어긋날 수 있는 것(동시성, 멱등성, outbox 소비자의 재전달·순서 포함), 권한·회사 범위를 넘어 읽거나 쓸 수 있는 것, 개인정보(주민등록번호 등)가 암호화·열람 기록 없이 나가는 것, 설계 문서·conventions.md와 어긋나는 코드, 동작을 바꾸고 설계 문서를 고치지 않은 것, 이슈가 요구했는데 빠진 것
- **후속:** 그 밖의 개선. 이 PR에서 고치지 않고 이슈로 남겨도 되는 것
