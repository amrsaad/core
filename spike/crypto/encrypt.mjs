// Verschlüsselt eine JSON-Datei mit AES-GCM 256 (WebCrypto-kompatibel).
// Aufruf: node spike/crypto/encrypt.mjs <in.json> <out.enc.json> [schluessel-base64url]
// Ohne Schlüssel wird einer erzeugt und NUR in eine Datei geschrieben (nie auf stdout).
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const [input, output, keyArg] = process.argv.slice(2);
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const raw = keyArg ? Buffer.from(keyArg, 'base64url') : crypto.getRandomValues(new Uint8Array(32));
if (raw.length !== 32) throw new Error('Schlüssel muss 32 Byte haben');
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const plain = new TextEncoder().encode(readFileSync(input, 'utf8'));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
writeFileSync(output, JSON.stringify({ v: 1, alg: 'AES-GCM-256', iv: b64u(iv), ct: b64u(ct) }));
if (!keyArg) writeFileSync(`${output}.key`, b64u(raw));
console.log(`verschlüsselt: ${output} (${plain.length} Byte Klartext)`);
