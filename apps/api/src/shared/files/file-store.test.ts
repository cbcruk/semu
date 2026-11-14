import { Effect, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../ids/ids.types.ts'
import { FileStore, allowedContentType, sniffContentType } from './file-store.ts'

const A = 'cmp_01JBQ00000000000000000000A' as Id<'company'>
const B = 'cmp_01JBQ00000000000000000000B' as Id<'company'>
const run = <X>(effect: Effect.Effect<X, never, FileStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(FileStore.layerMemory)))

describe('공통 파일 저장소(FileStore)', () => {
  it('올린 본문과 메타데이터를 그대로 돌려줍니다', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const read = await run(
      Effect.gen(function* () {
        const files = yield* FileStore
        const file = yield* files.put({
          companyId: A,
          name: 'a.pdf',
          contentType: 'application/pdf',
          bytes,
          createdBy: null,
        })
        return yield* files.read(A, file.id)
      }),
    )
    const value = Option.getOrThrow(read)
    expect(value.bytes).toEqual(bytes)
    expect(value.file).toMatchObject({
      name: 'a.pdf',
      size: 3,
      sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    })
    expect(value.file.id).toMatch(/^fle_/)
  })

  it('다른 회사의 파일은 없는 것과 같습니다', async () => {
    const found = await run(
      Effect.gen(function* () {
        const files = yield* FileStore
        const file = yield* files.put({
          companyId: A,
          name: 'a.png',
          contentType: 'image/png',
          bytes: new Uint8Array([1]),
          createdBy: null,
        })
        return [Option.isNone(yield* files.find(B, file.id)), Option.isNone(yield* files.read(B, file.id))]
      }),
    )
    expect(found).toEqual([true, true])
  })

  it('내용의 앞 바이트로 PDF·PNG·JPEG를 알아봅니다', () => {
    expect(sniffContentType(new TextEncoder().encode('%PDF-1.4'))).toBe('application/pdf')
    expect(sniffContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(sniffContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffContentType(new TextEncoder().encode('MZ'))).toBeUndefined()
  })

  it('형식은 매개변수를 떼고 대소문자 없이 봅니다', () => {
    expect(allowedContentType('Application/PDF; charset=binary')).toBe('application/pdf')
    expect(allowedContentType('text/plain')).toBeUndefined()
    expect(allowedContentType(undefined)).toBeUndefined()
  })
})
