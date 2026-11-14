import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { decidePayrollContractSigning } from '../contracts/payroll-contract.aggregate.ts'
import type { PayrollContractRecord } from '../contracts/payroll-contract.ts'
import { decideWorkContractSigning } from '../contracts/work-contract.aggregate.ts'
import type { WorkContractRecord } from '../contracts/work-contract.ts'
import type { EmployeeRecord } from '../employees/employee.ts'
import { documentCategoryOf, signedContractLinks } from './employee-document-rules.ts'
import { DocumentLocked, type EmployeeDocumentRecord } from './employee-document.ts'
import type { EmployeeDocumentCategory, SignedDocumentPart } from './employee-document.types.ts'

/**
 * 직원 문서 애그리거트입니다(docs/design/domain-model.md). 업로드·삭제와, 서명 문서 반영 묶음(EmployeeDocument +
 * WorkContract·PayrollContract 서명 연결)의 판정 함수를 둡니다.
 *
 * - 업로드: 파일 크기·형식 검사와 파일 저장은 서비스가 합니다(바깥 저장소 결과는 `context`, M8). 판정은 저장한 파일로 문서를 만듭니다
 * - 서명 문서 반영: 무효인 문서는 계약에 잇지 않고, 계약은 그 문서가 유효할 때만 그 문서를 가리킵니다. 판정이 문서와 바꿀 계약을
 *   함께 돌려주고 서비스가 한 트랜잭션에 저장합니다. 계약의 연결 변경은 계약 애그리거트의 서명 판정을 부릅니다
 *
 * 직원 문서는 이벤트를 내지 않습니다.
 */

/** 서명 문서 반영으로 바꿀 계약입니다. */
export interface SignedContracts {
  workContracts: WorkContractRecord[]
  payrollContracts: PayrollContractRecord[]
}

/** 서비스가 파일 저장소에 넣은 파일입니다. */
export interface StoredFile {
  id: Id<'file'>
  name: string
  contentType: string
}

/** 올릴 문서입니다. ID는 서비스가 정합니다. */
export interface DocumentUpload {
  id: Id<'document'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  category: EmployeeDocumentCategory
  title: string
  createdBy: Id<'user'>
}

/** 직접 올린 문서를 만듭니다. 막는 규칙은 서비스의 파일 검사뿐입니다. */
export function decideDocumentUpload(
  input: DocumentUpload,
  file: StoredFile,
  at: string,
): { document: EmployeeDocumentRecord } {
  return {
    document: {
      id: input.id,
      companyId: input.companyId,
      employeeId: input.employeeId,
      category: input.category,
      origin: 'UPLOAD',
      title: input.title,
      fileId: file.id,
      fileName: file.name,
      contentType: file.contentType,
      status: 'ACTIVE',
      createdBy: input.createdBy,
      createdAt: at,
      links: [],
    },
  }
}

/** 문서 삭제를 판정합니다. 직접 올린 문서만 지웁니다. 서명·발급 문서는 원본 보존을 위해 `DOCUMENT_LOCKED`입니다. */
export function decideDocumentRemoval(document: EmployeeDocumentRecord): Result.Result<void, DocumentLocked> {
  return document.origin === 'UPLOAD' ? Result.void : Result.fail(new DocumentLocked({ origin: document.origin }))
}

/** 서명이 끝난 전자서명 요청입니다. Documents의 `esign_request.completed`에서 옵니다. */
export interface CompletedEsignRequest {
  companyId: Id<'company'>
  esignRequestId: Id<'esignRequest'>
  /** 수신자가 직원이 아니면 없습니다. */
  employeeId?: Id<'employee'> | undefined
  title: string
  fileId: Id<'file'>
  signedAt: string
  documents: ReadonlyArray<SignedDocumentPart>
}

/** 서명 완료를 판정할 때 서비스가 읽어 둔 사실입니다. */
export interface SignedDocumentFacts {
  /** 같은 요청으로 이미 넣은 문서가 있는지입니다(최소 1회 전달이라 재전달). */
  alreadyFiled: boolean
  /** 무효가 완료보다 먼저 왔으면 그 시각입니다. */
  voidedAt?: string | undefined
  /** 직원이 지워졌으면 없습니다. */
  employee?: Pick<EmployeeRecord, 'joinDate'> | undefined
  /** 그 직원의 계약입니다. */
  workContracts: ReadonlyArray<WorkContractRecord>
  payrollContracts: ReadonlyArray<PayrollContractRecord>
}

/**
 * 서명 완료를 판정합니다. 넣을 것이 없으면(수신자가 직원이 아니거나 이미 넣음) `undefined`입니다.
 *
 * 완료본을 보관함 문서로 만들고, 문서가 확정하는 근로·급여계약({@link signedContractLinks})에 서명 문서를 잇습니다. 직원이
 * 지워졌으면 문서만 넣고 계약은 찾지 않습니다. 무효가 먼저 왔으면 문서를 `VOIDED`로 넣고 잇지 않습니다.
 */
export function decideSignedDocumentIntake(
  request: CompletedEsignRequest,
  id: Id<'document'>,
  facts: SignedDocumentFacts,
  at: string,
): ({ document: EmployeeDocumentRecord } & SignedContracts) | undefined {
  if (request.employeeId === undefined || facts.alreadyFiled) return undefined
  const links =
    facts.employee === undefined
      ? []
      : signedContractLinks(request.documents, {
          joinDate: facts.employee.joinDate,
          workContracts: facts.workContracts,
          payrollContracts: facts.payrollContracts,
        })
  const document: EmployeeDocumentRecord = {
    id,
    companyId: request.companyId,
    employeeId: request.employeeId,
    category: documentCategoryOf(request.documents.map((part) => part.kind)),
    origin: 'ESIGN',
    title: request.title,
    fileId: request.fileId,
    // 서명 완료본은 Documents가 `<제목>.pdf`로 저장합니다(`PdfRenderer`).
    fileName: `${request.title}.pdf`,
    contentType: 'application/pdf',
    esignRequestId: request.esignRequestId,
    signedAt: request.signedAt,
    createdAt: at,
    status: facts.voidedAt === undefined ? 'ACTIVE' : 'VOIDED',
    voidedAt: facts.voidedAt,
    links,
  }
  if (facts.voidedAt !== undefined) return { document, workContracts: [], payrollContracts: [] }
  return { document, ...signing(document, facts, id, at) }
}

/**
 * 서명 문서 무효를 판정합니다. 이미 무효면 `undefined`입니다. 문서를 `VOIDED`로 두고, 아직 그 문서를 가리키는 계약에서 서명
 * 문서를 풉니다. 예전 서명 문서로 되돌리지 않습니다. 그 사이 계약이 바뀌었을 수 있어 다시 서명받아야 확정으로 봅니다.
 * `contracts`는 문서의 연결이 가리키는 계약 중 남아 있는 것입니다. `voidedAt`은 무효 사건의 시각이고, 급여계약의 `updatedAt`은
 * 처리하는 시각 `at`입니다.
 */
export function decideSignedDocumentVoid(
  document: EmployeeDocumentRecord,
  contracts: Pick<SignedDocumentFacts, 'workContracts' | 'payrollContracts'>,
  voidedAt: string,
  at: string,
): ({ document: EmployeeDocumentRecord } & SignedContracts) | undefined {
  if (document.status === 'VOIDED') return undefined
  const voided: EmployeeDocumentRecord = { ...document, status: 'VOIDED', voidedAt }
  return { document: voided, ...signing(voided, contracts, undefined, at, voided.id) }
}

/** 문서의 연결이 가리키는 계약의 서명 연결을 `to`로 바꿉니다. `from`을 주면 지금 그 문서를 가리키는 계약만 바꿉니다. */
function signing(
  document: EmployeeDocumentRecord,
  contracts: Pick<SignedDocumentFacts, 'workContracts' | 'payrollContracts'>,
  to: Id<'document'> | undefined,
  at: string,
  from?: Id<'document'>,
): SignedContracts {
  const result: SignedContracts = { workContracts: [], payrollContracts: [] }
  for (const link of document.links) {
    if (link.type === 'WORK_CONTRACT') {
      const found = contracts.workContracts.find((contract) => contract.id === link.id)
      const decision = found === undefined ? undefined : decideWorkContractSigning(found, to, from)
      if (decision !== undefined) result.workContracts.push(decision.workContract)
    } else {
      const found = contracts.payrollContracts.find((contract) => contract.id === link.id)
      const decision = found === undefined ? undefined : decidePayrollContractSigning(found, to, at, from)
      if (decision !== undefined) result.payrollContracts.push(decision.payrollContract)
    }
  }
  return result
}
