// Prefer native hashing where available; HTTP reuses the project's shared SHA-256 implementation.
import { sha256Hex as portableSha256Hex } from '../../shared/sha256.js';

export async function sha256Hex(data, subtle = globalThis.crypto?.subtle) {
  if (subtle?.digest) {
    try {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
      return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    } catch { /* Use the same portable implementation as content-set validation. */ }
  }
  return portableSha256Hex(data);
}