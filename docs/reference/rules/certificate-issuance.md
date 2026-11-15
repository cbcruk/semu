# 제증명 발급

## 요약

- 발급번호는 회사·연도별 `YYYY-NNNN`, 그해 가장 큰 번호 + 1입니다
- 발급·발송 실패·발송 완료 상태에서 (재)발송하고, 발송 중에는 다시 보낼 수 없습니다
- 퇴직증명서는 퇴사일이 있는 직원만 발급합니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/certificates/certificates.repository.ts:19-64`
- `apps/api/legacy/src/modules/hr/certificates/certificates.service.ts:35-65, 130-160, 185-200, 291-300`
- `manual/08-설정/05-전자서명·제증명-관리.md:10`
- `certificates.repository.ts`의 `nextIssueNumber`
- `certificates.service.ts`의 `SENDABLE`, 삭제, 링크 만료
- 매뉴얼 설정 전자서명·제증명

## 로직

- `SENDABLE = issued | send_failed | sent` → `sending` → `sent | send_failed`
- 삭제는 상태와 상관없이 됩니다(번호가 MAX에서 빠져 다시 쓰일 수 있음)
- 링크는 발송 후 30일 유효

## 근거

`apps/api/legacy/src/modules/hr/certificates/certificates.repository.ts:19-22`

```ts
export function nextIssueNumber(db: DatabaseSync, companyId: string, year: number): string {
  const row = queryOne<{ n: number }>(db, 'SELECT COALESCE(MAX(CAST(substr(issue_number, 6) AS INTEGER)), 0) AS n FROM certificate_issuances WHERE company_id = ? AND issue_number LIKE ?', [companyId, `${year}-%`])
  return `${year}-${String((row?.n ?? 0) + 1).padStart(4, '0')}`
}
```

`apps/api/legacy/src/modules/hr/certificates/certificates.service.ts:185-200`

```ts
/** Deletes a certificate in any status; its download link stops working. */
export function removeCertificate(db: DatabaseSync, companyId: string, certificateId: number): void {
  if (!transaction(db, () => deleteCertificate(db, companyId, certificateId))) throw notFound('Certificate')
}

/**
 * Downloads one certificate as PDF, or several as a ZIP of PDFs.
 *
 * @throws {DomainError} `NOT_FOUND` when any ID is not a certificate of the company.
 */
export async function downloadCertificates(context: HrContext, companyId: string, ids: readonly number[]): Promise<CertificateDownload> {
  const certificates = [...new Set(ids)].map((id) => requireCertificate(context.deps.db, companyId, id))
  const files = await Promise.all(certificates.map(async (certificate) => ({ certificate, download: await readHrFile(context.deps, companyId, certificate.file_id) })))
  const only = files[0]
  if (files.length === 1 && only !== undefined) return { name: only.download.file.original_name, mimeType: 'application/pdf', data: only.download.data }
  const entries = files.map(({ certificate, download }) => ({ name: `${certificate.issue_number}_${download.file.original_name}`, data: download.data }))
```

## 서버 이전 시 주의

- 재설계는 삭제 대신 `:void`로 남겨 번호가 다시 쓰이지 않게 합니다(결정 1)

## 열린 질문

1. 현행은 증명서를 어떤 상태에서든 지웁니다(링크도 끊김). 발급번호 연속성을 위해 지우지 않고 무효(VOIDED)로 남길까요
2. 무효로 한 번호를 다시 쓰지 않습니다. 맞습니까
3. 링크 유효기간 30일을 회사 설정으로 둘까요

## 픽스처

[`apps/api/test/fixtures/rules/certificate-issuance.json`](../../../apps/api/test/fixtures/rules/certificate-issuance.json): 9건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| first of the year | `"2026-0001"` |
| next after highest | `"2026-0004"` |
| beyond four digits | `"2026-10000"` |
| send issued | `"SENDING"` |
| resend sent | `"SENDING"` |
| resend failed | `"SENDING"` |
| send while sending refused | `"CERTIFICATE_TRANSITION_INVALID"` |
| delivery result | `"SENT"` |
| remove while sending | `"DELETED"` |
