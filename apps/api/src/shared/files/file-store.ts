import { createHash } from 'node:crypto'
import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { newId } from '../ids/ids.ts'
import type { Id } from '../ids/ids.types.ts'
import { TableFactory } from '../persistence/record-table.ts'

/** 한 파일의 최대 크기(바이트)입니다. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024

/** 올릴 수 있는 파일 형식입니다. 신고 자료·계약서·도장 이미지·급여 엑셀을 덮습니다. */
export const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

/** 올릴 수 있는 파일 형식 하나입니다. */
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number]

/** 저장한 파일의 메타데이터입니다. 본문은 따로 둡니다. */
export interface StoredFile {
  id: Id<'file'>
  companyId: Id<'company'>
  /** 올린 사람이 붙인 파일 이름입니다. 내려받을 때 그대로 씁니다. */
  name: string
  contentType: AllowedContentType
  /** 바이트 수입니다. */
  size: number
  /** 본문의 SHA-256(소문자 16진수)입니다. */
  sha256: string
  /** 올린 사용자입니다. 서버가 만든 파일(서명 완료 PDF)은 `null`입니다. */
  createdBy: Id<'user'> | null
  createdAt: string
}

/** 저장할 파일입니다. */
export interface NewFile {
  companyId: Id<'company'>
  name: string
  contentType: AllowedContentType
  bytes: Uint8Array
  createdBy: Id<'user'> | null
}

/** 본문 행입니다. 표가 JSON이라 base64로 둡니다. */
interface FileContentRecord {
  id: Id<'file'>
  companyId: Id<'company'>
  base64: string
}

/**
 * 공통 파일 저장소입니다(D7, `docs/design/conventions.md`의 파일). 회사마다 파일을 두고 ID(`fle_`)로 찾습니다.
 *
 * 파일 자체에는 내려받기 권한이 없습니다. 파일을 붙인 리소스(직원 문서, 신고 건 문서)가 자기 읽기 권한으로 확인한 뒤
 * {@link FileStore.read}로 본문을 읽어 내려줍니다. 그래서 파일 ID만 알아서는 내려받을 수 없고, 다른 회사의 파일은 없는 것과 같습니다.
 *
 * 공유 인프라라 컨텍스트 앞자리 없는 표 `files`(메타데이터)와 `file_contents`(본문)에 둡니다. 저장 방식은 {@link TableFactory}가 정합니다.
 * 지우지 않습니다. 붙인 리소스가 지워져도 감사·분쟁을 위해 본문을 남깁니다.
 */
export class FileStore extends Context.Service<
  FileStore,
  {
    put(file: NewFile): Effect.Effect<StoredFile>
    /** 그 회사의 파일이면 메타데이터를 돌려줍니다. */
    find(companyId: Id<'company'>, id: Id<'file'>): Effect.Effect<Option.Option<StoredFile>>
    /** 그 회사의 파일이면 메타데이터와 본문을 돌려줍니다. */
    read(
      companyId: Id<'company'>,
      id: Id<'file'>,
    ): Effect.Effect<Option.Option<{ file: StoredFile; bytes: Uint8Array }>>
  }
>()('semu/shared/FileStore') {
  static readonly layer = Layer.effect(
    FileStore,
    Effect.gen(function* () {
      const tables = yield* TableFactory
      const files = yield* tables.make<StoredFile>('files', { companyOf: (file) => file.companyId })
      const contents = yield* tables.make<FileContentRecord>('file_contents', { companyOf: (row) => row.companyId })

      const find = (companyId: Id<'company'>, id: Id<'file'>) =>
        Effect.map(
          files.get(id),
          Option.filter((file) => file.companyId === companyId),
        )

      return FileStore.of({
        put: Effect.fn('FileStore.put')(function* (input) {
          const now = yield* DateTime.now
          const file: StoredFile = {
            id: newId('file'),
            companyId: input.companyId,
            name: input.name,
            contentType: input.contentType,
            size: input.bytes.byteLength,
            sha256: createHash('sha256').update(input.bytes).digest('hex'),
            createdBy: input.createdBy,
            createdAt: DateTime.formatIso(now),
          }
          yield* files.put(file)
          yield* contents.put({
            id: file.id,
            companyId: file.companyId,
            base64: Buffer.from(input.bytes).toString('base64'),
          })
          return file
        }),
        find,
        read: Effect.fn('FileStore.read')(function* (companyId, id) {
          const file = yield* find(companyId, id)
          if (Option.isNone(file)) return Option.none()
          const content = yield* contents.get(id)
          if (Option.isNone(content)) return Option.none()
          return Option.some({ file: file.value, bytes: new Uint8Array(Buffer.from(content.value.base64, 'base64')) })
        }),
      })
    }),
  )

  /** 프로세스 메모리에 둡니다. 컨텍스트 단위 테스트가 씁니다. */
  static readonly layerMemory = FileStore.layer.pipe(Layer.provide(TableFactory.layerMemory))
}

/** 올릴 수 있는 형식인지입니다. 매개변수(`; charset=…`)는 떼고 봅니다. */
export function allowedContentType(header: string | undefined): AllowedContentType | undefined {
  const mediaType = header?.split(';')[0]?.trim().toLowerCase()
  return ALLOWED_CONTENT_TYPES.find((allowed) => allowed === mediaType)
}

/**
 * 본문의 앞 바이트(매직 넘버)로 형식을 판정합니다. 클라이언트가 보낸 `Content-Type`을 믿지 않을 때 씁니다.
 * PDF·PNG·JPEG만 알아보고, 그 밖은 `undefined`입니다.
 */
export function sniffContentType(bytes: Uint8Array): 'application/pdf' | 'image/png' | 'image/jpeg' | undefined {
  const startsWith = (signature: ReadonlyArray<number>) => signature.every((byte, index) => bytes[index] === byte)
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg'
  return undefined
}
