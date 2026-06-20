// IMPLEMENTED (Phase 2, Track C2). E2E crypto for chat. A shared passphrase derives
// BOTH the AES-GCM key (PBKDF2 via WebCrypto) and a hard-to-guess topic, so a wrong
// passphrase yields a different topic AND key. Messages: {user,text,ts}, encrypted
// with a 12-byte random IV prepended. crypto.subtle is available in the renderer
// normally. Signatures are FROZEN.

export interface ChatMessage {
  user: string;
  text: string;
  ts: number;
}

// App-constant salts. DISTINCT salts for the key and the topic so the two PBKDF2
// outputs are independent: a wrong passphrase lands on a different topic AND a key
// that cannot decrypt anything. These are not secret (both clients ship them); the
// secret is the shared passphrase exchanged out of band.
const KEY_SALT = new TextEncoder().encode('nexus7::chat::aes-gcm::v1');
const TOPIC_SALT = new TextEncoder().encode('nexus7::chat::topic::v1');

const PBKDF2_ITERATIONS = 150_000;
const IV_BYTES = 12; // AES-GCM standard nonce length

/** Import the passphrase as raw PBKDF2 key material. */
async function importPassphrase(passphrase: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey', 'deriveBits']
  );
}

/** Derive the AES-GCM 256 key from the shared passphrase (PBKDF2, SHA-256). */
export async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const material = await importPassphrase(passphrase);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: KEY_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive a hard-to-guess MQTT topic from the passphrase (PBKDF2 with a DIFFERENT
 * salt than the key). Returns "nexus7/" + the first 24 hex chars (96 bits) of the
 * derived material, so the topic is stable per passphrase but reveals nothing.
 */
export async function deriveTopic(passphrase: string): Promise<string> {
  const material = await importPassphrase(passphrase);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: TOPIC_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    material,
    128 // derive 16 bytes; we use the first 12 (24 hex chars)
  );
  const hex = bytesToHex(new Uint8Array(bits));
  return 'nexus7/' + hex.slice(0, 24);
}

/**
 * Encrypt a message with AES-GCM. Returns IV (12 random bytes) prepended to the
 * ciphertext as a single Uint8Array. The caller (mqtt-client) base64-encodes this
 * for the wire.
 */
export async function encryptMsg(key: CryptoKey, msg: ChatMessage): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(msg));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const cipherBytes = new Uint8Array(cipher);
  const out = new Uint8Array(iv.length + cipherBytes.length);
  out.set(iv, 0);
  out.set(cipherBytes, iv.length);
  return out;
}

/**
 * Decrypt a payload (12-byte IV prepended) -> message, or null if it fails. A wrong
 * key, a truncated payload, a non-JSON plaintext, or a malformed shape all yield
 * null so the caller can simply ignore the message (e.g. a different passphrase).
 */
export async function decryptMsg(key: CryptoKey, payload: Uint8Array): Promise<ChatMessage | null> {
  try {
    if (!payload || payload.length <= IV_BYTES) return null;
    // .slice() (not .subarray()) returns fresh ArrayBuffer-backed views, which
    // satisfy WebCrypto's BufferSource typing across lib versions.
    const iv = payload.slice(0, IV_BYTES);
    const cipher = payload.slice(IV_BYTES);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    const obj = JSON.parse(new TextDecoder().decode(plain)) as unknown;
    return normalizeMessage(obj);
  } catch {
    // wrong key / tampered / not our payload: ignore
    return null;
  }
}

// Defensive caps on incoming (decoded) message fields. The local input path caps
// the callsign at 24 chars, but a remote sender on the PUBLIC broker can craft a
// validly-encrypted message with arbitrarily large user/text. textContent keeps this
// XSS-safe, but a multi-hundred-KB string in one DOM node forces a large layout/reflow,
// so we clamp on read here (the single chokepoint every incoming message passes through).
const MAX_TEXT = 2000;
const MAX_USER = 64;

/** Validate and coerce a decrypted object into a ChatMessage, or null. */
function normalizeMessage(obj: unknown): ChatMessage | null {
  if (!obj || typeof obj !== 'object') return null;
  const m = obj as Record<string, unknown>;
  if (typeof m.user !== 'string' || typeof m.text !== 'string') return null;
  const ts = typeof m.ts === 'number' && Number.isFinite(m.ts) ? m.ts : Date.now();
  return { user: m.user.slice(0, MAX_USER), text: m.text.slice(0, MAX_TEXT), ts };
}

/** Lowercase hex of a byte array. */
function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}
