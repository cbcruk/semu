import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppDeps, AppEnv } from '../../../app.types'
import { ATTACHMENT_UPLOAD_PATH, storeSignedUpload } from './misc.service'

/**
 * Public routes that accept signed attachment uploads.
 *
 * The signature in the path is the credential, like a presigned object
 * storage URL, so the route is mounted before authentication.
 */
export function miscPublicRoutes(deps: AppDeps): Hono<AppEnv> {
  const limit = bodyLimit({
    maxSize: deps.maxUploadBytes,
    onError: (c) => c.json({ detail: 'The file is too large.', code: 'PAYLOAD_TOO_LARGE' }, 413),
  })
  return new Hono<AppEnv>().put(`${ATTACHMENT_UPLOAD_PATH}/:token`, limit, async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    return c.json(await storeSignedUpload(deps, c.req.param('token'), bytes), 201)
  })
}
