/**
 * Authentication helpers for Hive.
 *
 * Uses libsodium Ed25519 signature verification:
 *   - Server issues a 32-byte random nonce (base64) as a challenge.
 *   - Client signs concat(nonce_bytes || peerId_utf8) and returns sig (base64).
 *   - Server verifies with the client's registered Ed25519 public key.
 */
import sodium from 'libsodium-wrappers-sumo';

let _ready = false;

export async function ensureSodium(): Promise<void> {
  if (!_ready) {
    await sodium.ready;
    _ready = true;
  }
}

/** Generate a random 32-byte nonce, returned as base64. */
export function generateNonce(): string {
  const buf = Buffer.allocUnsafe(32);
  // Use Node crypto for the random bytes — no need to wait for libsodium.
  require('node:crypto').getRandomValues(buf);
  return buf.toString('base64');
}

/**
 * Verify that `sigB64` is a valid Ed25519 signature of
 * (base64_nonce_bytes || peerId_utf8) under `pubKeyB64`.
 *
 * Both nonce and pubkey are base64-encoded strings.
 */
export function verifyAuthSignature(pubKeyB64: string, nonceB64: string, peerId: string, sigB64: string): boolean {
  try {
    const pubKey = Buffer.from(pubKeyB64, 'base64');
    const nonce = Buffer.from(nonceB64, 'base64');
    const peerIdBytes = Buffer.from(peerId, 'utf8');
    const message = Buffer.concat([nonce, peerIdBytes]);
    const sig = Buffer.from(sigB64, 'base64');

    return sodium.crypto_sign_verify_detached(sig, message, pubKey);
  } catch {
    return false;
  }
}
