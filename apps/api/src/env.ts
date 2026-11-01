import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_PATH: z.string().default('./data/api.sqlite'),
  STORAGE_DIR: z.string().default('./storage'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters.'),
  ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64-encoded.'),
  TAX_TERMS_VERSION: z.string().default('2026-01'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
})

/** Validated process environment. */
export type Env = z.infer<typeof envSchema>

/**
 * Parses and validates environment variables.
 *
 * @throws {Error} Listing every invalid variable.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')
    throw new Error(`Invalid environment:\n${details}`)
  }
  return result.data
}
