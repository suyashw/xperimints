import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope-style encryption for integration credentials.
 *
 * The master key is read from `INTEGRATION_KMS_MASTER_KEY` (32-byte base64).
 * For local dev where the env var is missing, we deterministically derive a
 * key from a fixed dev-only string so the demo remains functional — clearly
 * marked as insecure in logs at boot time.
 */

let cachedKey: Buffer | null = null;

function loadMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.INTEGRATION_KMS_MASTER_KEY;
  if (fromEnv && fromEnv.length > 0) {
    let buf: Buffer;
    try {
      buf = Buffer.from(fromEnv, 'base64');
    } catch {
      buf = Buffer.from(fromEnv, 'utf8');
    }
    if (buf.length !== 32) {
      // Hash arbitrary length material down to 32 bytes deterministically so
      // misconfigured keys still produce a usable key (we still log a warning
      // at the call site).
      buf = createHash('sha256').update(buf).digest();
    }
    cachedKey = buf;
    return cachedKey;
  }
  // Dev-only fallback. Stable so re-encryption / decryption across restarts
  // works without losing previously stored rows. Replace in production.
  cachedKey = createHash('sha256')
    .update('peec-lab-dev-only-INTEGRATION_KMS_MASTER_KEY-not-for-production')
    .digest();
  return cachedKey;
}

interface SealedCredentials {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encryptJson(value: unknown): SealedCredentials {
  const key = loadMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

export function decryptJson<T = unknown>(sealed: SealedCredentials): T {
  const key = loadMasterKey();
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
  decipher.setAuthTag(sealed.tag);
  const plaintext = Buffer.concat([
    decipher.update(sealed.ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
