/**
 * Password hashing for the minimal authentication layer.
 *
 * Uses Node's built-in `node:crypto` scrypt KDF (memory-hard, well-established)
 * with a per-user random salt and constant-time comparison. No cryptography is
 * hand-implemented and no plaintext is ever stored.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Produces `scrypt$<saltBase64>$<hashBase64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Constant-time verification of a password against a stored hash string. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  const actual = await derive(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}