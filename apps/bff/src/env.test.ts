import { describe, expect, it } from 'vitest'
import { positiveIntegerEnv } from './env.ts'

describe('positiveIntegerEnv', () => {
  it('uses the default when the variable is missing or empty', () => {
    expect(positiveIntegerEnv({}, 'BFF_UPSTREAM_MAX_RESPONSE_BYTES', 10)).toBe(10)
    expect(positiveIntegerEnv({ BFF_UPSTREAM_MAX_RESPONSE_BYTES: '' }, 'BFF_UPSTREAM_MAX_RESPONSE_BYTES', 10)).toBe(10)
    expect(positiveIntegerEnv({ BFF_UPSTREAM_MAX_RESPONSE_BYTES: '  ' }, 'BFF_UPSTREAM_MAX_RESPONSE_BYTES', 10)).toBe(
      10,
    )
  })

  it('reads a positive integer', () => {
    expect(positiveIntegerEnv({ BFF_UPSTREAM_TIMEOUT_MS: '2500' }, 'BFF_UPSTREAM_TIMEOUT_MS', 10)).toBe(2500)
  })

  it.each(['abc', '0', '-1', '1.5', '1e6', '10MB'])('refuses %j with a message naming the variable', (raw) => {
    expect(() => positiveIntegerEnv({ BFF_AUTH_TIMEOUT_MS: raw }, 'BFF_AUTH_TIMEOUT_MS', 10)).toThrow(
      /BFF_AUTH_TIMEOUT_MS must be a positive integer/,
    )
  })
})
