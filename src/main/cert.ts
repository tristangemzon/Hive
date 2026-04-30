/**
 * TLS certificate management for Hive.
 *
 * On first run, generates a self-signed X.509 certificate using node:crypto.
 * The cert + key are stored in Electron's userData directory so they persist
 * across app restarts. Users can override with real cert paths via config.
 */
import { createPrivateKey, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export type CertBundle = {
  certPem: string;
  keyPem: string;
};

/**
 * Returns TLS cert + key PEM strings.
 * If certPath/keyPath are provided and exist, those files are used.
 * Otherwise auto-generates (or loads) a self-signed cert in userData.
 */
export function getCertBundle(certPath?: string, keyPath?: string): CertBundle {
  if (certPath && keyPath && existsSync(certPath) && existsSync(keyPath)) {
    return {
      certPem: readFileSync(certPath, 'utf8'),
      keyPem: readFileSync(keyPath, 'utf8'),
    };
  }

  const userData = app.getPath('userData');
  const autoCertPath = join(userData, 'hive-cert.pem');
  const autoKeyPath = join(userData, 'hive-key.pem');

  if (existsSync(autoCertPath) && existsSync(autoKeyPath)) {
    return {
      certPem: readFileSync(autoCertPath, 'utf8'),
      keyPem: readFileSync(autoKeyPath, 'utf8'),
    };
  }

  // Generate a new self-signed cert.
  const { cert, key } = generateSelfSigned();
  writeFileSync(autoCertPath, cert, { mode: 0o600 });
  writeFileSync(autoKeyPath, key, { mode: 0o600 });
  return { certPem: cert, keyPem: key };
}

function generateSelfSigned(): { cert: string; key: string } {
  // Generate an RSA-2048 key pair (widely compatible with https.createServer).
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Build a minimal self-signed cert using node:crypto X509Certificate.
  // node:crypto's X509Certificate constructor accepts DER only; we need the
  // low-level forge/tls approach — instead use the built-in selfsigned approach
  // via the `generate` helper below.
  const cert = buildSelfSignedPem(privateKey as unknown as string, publicKey as unknown as string);
  return { cert, key: privateKey as unknown as string };
}

/**
 * Builds a self-signed PEM certificate using Node.js built-ins only.
 *
 * Node 15+ has `crypto.X509Certificate` for reading but NOT for creating certs.
 * The only stable built-in creation path is `tls.createSecureContext` which
 * also cannot generate. So we use the `crypto.generateCertificate` API
 * introduced experimentally in Node 22 — but we can't rely on that.
 *
 * Fallback: use `child_process` to call `openssl req -x509` which is available
 * on all platforms that ship Electron. This is the most reliable cross-platform
 * approach without adding a dep.
 */
function buildSelfSignedPem(privateKeyPem: string, _publicKeyPem: string): string {
  const { execFileSync } = require('node:child_process');
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join: j } = require('node:path');

  const dir = mkdtempSync(j(tmpdir(), 'hive-cert-'));
  const keyFile = j(dir, 'key.pem');
  const certFile = j(dir, 'cert.pem');

  try {
    wf(keyFile, privateKeyPem, { mode: 0o600 });
    execFileSync('openssl', [
      'req', '-new', '-x509',
      '-key', keyFile,
      '-out', certFile,
      '-days', '3650',
      '-subj', '/CN=hive-server/O=Hive/C=US',
      '-nodes',
    ]);
    return rf(certFile, 'utf8') as string;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
