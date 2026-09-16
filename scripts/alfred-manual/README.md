# alfred-manual 크롤러

[support.alfred.kr](https://support.alfred.kr/)(Oopy/Notion 기반 Alfred Business 매뉴얼)을 크롤링해서
레포 루트의 [`alfred-manual/`](../../alfred-manual)에 마크다운 트리로 저장합니다.

## 준비

```sh
cd scripts/alfred-manual
uv venv && uv pip install -r requirements.txt
.venv/bin/playwright install chromium
```

## 실행

```sh
.venv/bin/python crawl.py            # 1. 전체 페이지 렌더링 → .cache/pages/*.html, .cache/graph.json (약 1시간)
.venv/bin/python convert.py          # 2. HTML → alfred-manual/**/*.md
.venv/bin/python localize_images.py  # 3. 이미지 다운로드 → alfred-manual/images/, 링크를 로컬 경로로 교체
```

- 세 단계는 반드시 순서대로 실행합니다. `convert.py`는 원격 이미지 URL로 마크다운을 다시 만들고, `localize_images.py`가 이를 로컬 경로로 바꿉니다.
- `convert.py`와 `localize_images.py`는 `.cache/`만 사용하므로 크롤링을 다시 하지 않고도 변환 로직을 수정해 재실행할 수 있습니다.
- `.cache/`는 git에 포함되지 않습니다.

## 동작 방식

| 단계 | 내용 |
| --- | --- |
| 크롤링 | Playwright(headless Chromium)로 루트부터 BFS. 페이지마다 스크롤로 lazy 블록을 불러오고 토글을 모두 펼친 뒤 HTML을 저장합니다. 본문 안의 `support.alfred.kr` 링크만 따라가며, `oppy hide :` 토글(방문자에게 숨겨진 영역) 안의 링크는 무시합니다. |
| 트리 구성 | 페이지를 **처음 링크한 페이지**의 하위로 둡니다. Notion 상의 실제 부모는 대부분 하나의 데이터베이스라 트리로 쓸 수 없기 때문입니다. 형제 순서는 부모 페이지에서 링크가 나온 순서입니다. |
| 변환 | `notion-*-block` DOM을 블록 단위로 마크다운으로 바꿉니다(제목, 목록, 토글, 콜아웃, 표, 이미지, DB 뷰 등). 본문이 비어 있는 DB 행 페이지(서식 등)는 `__NEXT_DATA__`의 속성을 표로 붙입니다. 내부 링크는 상대 경로 `.md` 링크로 바뀝니다. |
| 이미지 | CDN 콘텐츠 해시로 파일명을 정해 중복 없이 저장합니다. 서버가 webp로만 내려주는 이미지는 `.webp`로 저장됩니다. |
