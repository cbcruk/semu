import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../problem/problem.ts'

/** 파일(요청 본문)이 크기 한도를 넘거나 비어 있습니다. */
export class FileSizeInvalid extends HttpApiError.Problem<FileSizeInvalid>()(
  'FileSizeInvalid',
  { type: problemType('FILE_SIZE_INVALID'), status: 413, title: 'File is empty or too large' },
  { code: Schema.tag('FILE_SIZE_INVALID'), maxBytes: Schema.Number },
) {}
