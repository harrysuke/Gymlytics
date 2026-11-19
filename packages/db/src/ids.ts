/**
 * UUIDv7 — 48-bit unix-ms timestamp + version/variant + random tail.
 *
 * Why not UUIDv4? Offline kiosks create rows before the server ever sees them,
 * so ids must be client-generated (no autoincrement collisions on merge) AND
 * time-sortable, otherwise every insert lands on a random B-tree page and index
 * locality degrades badly once the table has a few hundred thousand rows.
 *
 * Implemented against `globalThis.crypto` so the same function runs in Node 20,
 * in the browser, and in React Native without importing `node:crypto` (which
 * would break the Vite bundle).
 */
interface CryptoLike {
  getRandomValues(array: Uint8Array): Uint8Array;
}

function fillRandom(bytes: Uint8Array): Uint8Array {
  const crypto = (globalThis as { crypto?: CryptoLike }).crypto;
  if (crypto?.getRandomValues) return crypto.getRandomValues(bytes);

  // Last-resort fallback for exotic runtimes. Not cryptographically strong, but
  // ids are identifiers, not secrets — uniqueness is all that matters here.
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

export function uuidv7(now: number = Date.now()): string {
  const bytes = fillRandom(new Uint8Array(16));
  const ts = BigInt(Math.floor(now));

  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant

  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
