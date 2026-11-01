/** Encrypts and decrypts short secrets such as resident registration numbers and integration passwords. */
export interface Cipher {
  /** Encrypts UTF-8 text into an opaque, versioned token safe to store in a TEXT column. */
  encrypt(plaintext: string): string
  /**
   * Decrypts a token produced by {@linkcode Cipher.encrypt}.
   *
   * @throws {Error} When the token is malformed or was not produced with this key.
   */
  decrypt(token: string): string
}
