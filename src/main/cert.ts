/**
 * TLS certificate management for Hive.
 *
 * On first run, generates a self-signed X.509 certificate using node:crypto.
 * The cert + key are stored in Electron's userData directory so they persist
 * across app restarts. Users can override with real cert paths via config.
 */
import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
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
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const cert = buildSelfSignedDer(privateKey as unknown as string, publicKey as Buffer);
  return { cert, key: privateKey as unknown as string };
}

// ---------------------------------------------------------------------------
// Minimal ASN.1 DER encoder — enough to produce an X.509 v3 self-signed cert
// without any external tools or npm packages.
// ---------------------------------------------------------------------------

function tlv(tag: number, ...payloads: Buffer[]): Buffer {
  const body = Buffer.concat(payloads);
  const len = body.length;
  let lenBuf: Buffer;
  if (len < 0x80) {
    lenBuf = Buffer.from([len]);
  } else if (len < 0x100) {
    lenBuf = Buffer.from([0x81, len]);
  } else if (len < 0x10000) {
    lenBuf = Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  } else {
    throw new Error('ASN.1 length too large');
  }
  return Buffer.concat([Buffer.from([tag]), lenBuf, body]);
}

const seq  = (...i: Buffer[]) => tlv(0x30, ...i);
const set  = (...i: Buffer[]) => tlv(0x31, ...i);
const ctx0 = (...i: Buffer[]) => tlv(0xa0, ...i);

function derInt(val: Buffer): Buffer {
  const pad = (val[0] & 0x80) ? Buffer.from([0x00]) : Buffer.alloc(0);
  return tlv(0x02, Buffer.concat([pad, val]));
}

function derOid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const bytes: number[] = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let n = parts[i];
    const chunk: number[] = [n & 0x7f];
    n >>>= 7;
    while (n > 0) {
      chunk.unshift((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function utcTime(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, '0');
  const s = `${String(d.getUTCFullYear()).slice(-2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, 'ascii'));
}

function utf8Str(s: string):      Buffer { return tlv(0x0c, Buffer.from(s, 'utf8'));   }
function printableStr(s: string): Buffer { return tlv(0x13, Buffer.from(s, 'ascii'));  }
function bitStr(data: Buffer):    Buffer { return tlv(0x03, Buffer.from([0x00]), data); }

// OID: sha256WithRSAEncryption
const SHA256_RSA_OID = '1.2.840.113549.1.1.11';
const algoId = seq(derOid(SHA256_RSA_OID), Buffer.from([0x05, 0x00]));

function buildDistinguishedName(): Buffer {
  return seq(
    set(seq(derOid('2.5.4.6'),  printableStr('US'))),
    set(seq(derOid('2.5.4.10'), utf8Str('Hive'))),
    set(seq(derOid('2.5.4.3'),  utf8Str('hive-server'))),
  );
}

function buildSelfSignedDer(privateKeyPem: string, spkiDer: Buffer): string {
  const now = new Date();
  const notAfter = new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000);

  // Serial: 16-byte random positive integer (first byte forced non-zero)
  const serialBytes = randomBytes(16);
  serialBytes[0] = (serialBytes[0] & 0x7f) | 0x01;

  const dn = buildDistinguishedName();

  const tbsCert = seq(
    ctx0(derInt(Buffer.from([0x02]))),            // version: v3
    derInt(serialBytes),                           // serialNumber
    algoId,                                        // signature algorithm
    dn,                                            // issuer
    seq(utcTime(now), utcTime(notAfter)),          // validity
    dn,                                            // subject
    spkiDer,                                       // subjectPublicKeyInfo (already DER)
  );

  const sign = createSign('SHA256');
  sign.update(tbsCert);
  const sig = sign.sign(privateKeyPem);

  const certDer = seq(tbsCert, algoId, bitStr(sig));

  const b64 = certDer.toString('base64').replace(/.{64}/g, '$&\n');
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}
