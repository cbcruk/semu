# 전자서명 설정 한도

## 요약

- 회사 도장·사인은 최대 5개(지운 것 제외), 알림톡 수신자는 최대 3명입니다
- 수신자를 정하지 않으면 대표자에게 보냅니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/e-sign/e-sign-settings.service.ts:25, 100-160`
- `alfred-manual/04-인사/03-전자서명.md:52`
- `alfred-manual/08-설정/05-전자서명·제증명-관리.md:43`
- `docs/reference/spec/hr.md:660-661`
- `e-sign-settings.service.ts`의 `MAX_COMPANY_SEALS`, `putNotiRecipients`
- 매뉴얼 전자서명, 설정

## 로직

- `countActiveSeals ≥ 5` → `SEAL_LIMIT_EXCEEDED`
- 수신자 4명 이상은 스키마에서 거절

## 근거

`apps/api/legacy/src/modules/hr/e-sign/e-sign-settings.service.ts:100-112`

```ts
 *
 * @throws {HrError} `SEAL_LIMIT_EXCEEDED` when five seals already exist.
 */
export async function addSeal(deps: ServiceDeps, companyId: string, upload: HrUpload, userId: string): Promise<CompanySealRow> {
  if (countActiveSeals(deps.db, companyId) >= MAX_COMPANY_SEALS) throw sealLimit()
  const source = upload.fields['source'] === 'drawn' ? 'drawn' : 'upload'
  const prepared = await prepareHrFile(deps, companyId, upload, userId, IMAGE_MIME_TYPES)
  return commitHrFile(deps, prepared, (file) => {
    if (countActiveSeals(deps.db, companyId) >= MAX_COMPANY_SEALS) throw sealLimit()
    const id = insertSeal(deps.db, companyId, file.id, source, userId, deps.clock.now())
    return requireActiveSeal(deps.db, companyId, id, 'seal')
  })
}
```

`alfred-manual/04-인사/03-전자서명.md:52-52`

```md
  전자 서명의 완료, 기한 만료 등의 카카오톡 알림을 받을 사람을 설정하는 메뉴입니다. 별도로 설정하지 않으면 **대표자 연락처**로 기본 등록됩니다. **알림톡 수신처는 3명**까지 입력할 수 있습니다.
```

## 서버 이전 시 주의

- 도장은 파일 ID로 식별합니다(`companySeal` ID 접두사가 없어 임시로 `fle_`)

## 열린 질문

1. 지운 도장은 한도에 세지 않지만 지운 도장으로 찍은 완료 문서는 그대로 남습니다. 지운 도장 파일을 계속 보관할까요
2. 대표자 연락처는 회사 컨텍스트 소유입니다. 문서 컨텍스트가 포트로 읽으면 될까요

## 픽스처

[`apps/api/test/fixtures/rules/esign-settings-limits.json`](../../../apps/api/test/fixtures/rules/esign-settings-limits.json): 6건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| fourth seal | `true` |
| sixth seal refused | `false` |
| configured recipients | `[{"phone": "01011112222"}]` |
| no configured falls back to representative | `[{"phone": "01099998888"}]` |
| no one to notify | `[]` |
| four recipients refused | `"RECIPIENT_LIMIT_EXCEEDED"` |
