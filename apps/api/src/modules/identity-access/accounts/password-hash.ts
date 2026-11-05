import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const COST = 16_384
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_LENGTH = 64

/**
 * 비밀번호를 scrypt로 해시합니다. 형식은 `scrypt$N$r$p$salt$hash`(base64url)입니다.
 *
 * 비용 인자를 문자열에 담아 나중에 비용을 올려도 옛 해시가 그대로 검증됩니다. 현행 구현과 같은 형식입니다.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM })
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64url'), hash.toString('base64url')].join('$')
}

/** {@link hashPassword}의 해시와 비밀번호를 상수 시간으로 비교합니다. */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, cost, blockSize, parallelism, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelism),
  })
  return timingSafeEqual(actual, expected)
}
