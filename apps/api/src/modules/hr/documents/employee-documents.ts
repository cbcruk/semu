import { FileSizeInvalid } from '../../../shared/files/file-errors.ts'
import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { FileStore, MAX_FILE_BYTES, sniffContentType } from '../../../shared/files/file-store.ts'
import { PersonalDataAccessLog } from '../../../shared/personal-data/personal-data-access-log.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeNotFound } from '../employees/employee.ts'
import {
  ARCHIVE_CONTENT_TYPES,
  DocumentFileMissing,
  DocumentFileTypeNotAllowed,
  DocumentLocked,
  EmployeeDocumentNotFound,
  EmployeeDocumentRepository,
  type EmployeeDocument,
  type EmployeeDocumentRecord,
} from './employee-document.ts'
import type { EmployeeDocumentCategory } from './employee-document.types.ts'

/** 직접 올리는 문서입니다. */
export interface EmployeeDocumentUpload {
  title: string
  category: EmployeeDocumentCategory
  fileName: string
  bytes: Uint8Array
}

/** 내려받을 문서 본문입니다. */
export interface EmployeeDocumentContent {
  fileName: string
  contentType: string
  bytes: Uint8Array
}

/**
 * 직원 문서 보관함입니다. 전자서명 완료본은 이벤트로 들어오고({@link SignedDocumentIntake}), 그 밖의 문서는 직접 올립니다.
 *
 * 파일 본문은 공통 파일 저장소(`FileStore`, D7)에 두고, 내려받기는 이 보관함의 읽기 권한으로 확인한 뒤 내려줍니다.
 */
export class EmployeeDocuments extends Context.Service<
  EmployeeDocuments,
  {
    /** 서명 시각(없으면 들어온 시각)이 늦은 것부터입니다. */
    list(
      actor: Actor,
      employeeId: Id<'employee'>,
      category?: EmployeeDocumentCategory,
    ): Effect.Effect<EmployeeDocument[], EmployeeNotFound>
    get(actor: Actor, id: Id<'document'>): Effect.Effect<EmployeeDocument, EmployeeDocumentNotFound>
    /** 문서를 직접 올립니다. 지운 직원에게는 올릴 수 없습니다. */
    upload(
      actor: Actor,
      employeeId: Id<'employee'>,
      upload: EmployeeDocumentUpload,
    ): Effect.Effect<EmployeeDocument, EmployeeNotFound | DocumentFileTypeNotAllowed | FileSizeInvalid>
    /**
     * 문서 본문입니다. 무효가 된 서명 문서도 기록이라 내려받을 수 있습니다. 계약서·증명서에 개인정보가 있어 열람 기록
     * (`employee-document:<id>:file`)에 사유와 함께 남깁니다.
     */
    content(
      actor: Actor,
      id: Id<'document'>,
      reason: string,
    ): Effect.Effect<EmployeeDocumentContent, EmployeeDocumentNotFound | DocumentFileMissing>
    /** 직접 올린 문서를 지웁니다. 서명 완료본은 `DOCUMENT_LOCKED`입니다. 파일 본문은 남깁니다. */
    remove(actor: Actor, id: Id<'document'>): Effect.Effect<void, EmployeeDocumentNotFound | DocumentLocked>
  }
>()('semu/hr/EmployeeDocuments') {
  static readonly layer = Layer.effect(
    EmployeeDocuments,
    Effect.gen(function* () {
      const documents = yield* EmployeeDocumentRepository
      const employees = yield* EmployeeRepository
      const files = yield* FileStore
      const accessLog = yield* PersonalDataAccessLog

      const toView = ({ companyId: _, createdBy: __, links, ...rest }: EmployeeDocumentRecord): EmployeeDocument => ({
        ...stripUndefined(rest),
        links: [...links],
      })

      const find = (actor: Actor, id: Id<'document'>) =>
        Effect.flatMap(
          documents.find(actor.companyId, id),
          Option.match({ onNone: () => Effect.fail(new EmployeeDocumentNotFound({})), onSome: Effect.succeed }),
        )

      return EmployeeDocuments.of({
        list: Effect.fn('EmployeeDocuments.list')(function* (actor, employeeId, category) {
          if (Option.isNone(yield* employees.find(actor.companyId, employeeId))) return yield* new EmployeeNotFound({})
          return (yield* documents.list(actor.companyId))
            .filter(
              (document) =>
                document.employeeId === employeeId && (category === undefined || document.category === category),
            )
            .toSorted((a, b) => sortKey(b).localeCompare(sortKey(a)))
            .map(toView)
        }),

        get: Effect.fn('EmployeeDocuments.get')(function* (actor, id) {
          return toView(yield* find(actor, id))
        }),

        upload: Effect.fn('EmployeeDocuments.upload')(function* (actor, employeeId, upload) {
          if (Option.isNone(yield* employees.find(actor.companyId, employeeId))) return yield* new EmployeeNotFound({})
          if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > MAX_FILE_BYTES) {
            return yield* new FileSizeInvalid({ maxBytes: MAX_FILE_BYTES })
          }
          // 형식은 보낸 `Content-Type`이 아니라 내용으로 정합니다.
          const contentType = sniffContentType(upload.bytes)
          if (contentType === undefined) {
            return yield* new DocumentFileTypeNotAllowed({ allowedContentTypes: [...ARCHIVE_CONTENT_TYPES] })
          }
          const file = yield* files.put({
            companyId: actor.companyId,
            name: upload.fileName,
            contentType,
            bytes: upload.bytes,
            createdBy: actor.userId,
          })
          const record: EmployeeDocumentRecord = {
            id: newId('document'),
            companyId: actor.companyId,
            employeeId,
            category: upload.category,
            origin: 'UPLOAD',
            title: upload.title,
            fileId: file.id,
            fileName: file.name,
            contentType: file.contentType,
            status: 'ACTIVE',
            createdBy: actor.userId,
            createdAt: DateTime.formatIso(yield* DateTime.now),
            links: [],
          }
          yield* documents.save(record)
          return toView(record)
        }),

        content: Effect.fn('EmployeeDocuments.content')(function* (actor, id, reason) {
          const document = yield* find(actor, id)
          const stored = yield* files.read(actor.companyId, document.fileId)
          if (Option.isNone(stored)) return yield* new DocumentFileMissing({})
          yield* accessLog.record({
            companyId: actor.companyId,
            userId: actor.userId,
            target: `employee-document:${document.id}:file`,
            reason,
            at: DateTime.formatIso(yield* DateTime.now),
          })
          return { fileName: document.fileName, contentType: document.contentType, bytes: stored.value.bytes }
        }),

        remove: Effect.fn('EmployeeDocuments.remove')(function* (actor, id) {
          const document = yield* find(actor, id)
          if (document.origin !== 'UPLOAD') return yield* new DocumentLocked({ origin: document.origin })
          yield* documents.remove(document.id)
        }),
      })
    }),
  )
}

function sortKey(document: EmployeeDocumentRecord): string {
  return document.signedAt ?? document.createdAt
}
