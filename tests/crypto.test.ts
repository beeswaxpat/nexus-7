import { describe, it, expect } from 'vitest';
import {
  deriveTopic,
  deriveKey,
  encryptMsg,
  decryptMsg,
  type ChatMessage
} from '../src/renderer/panels/chat/crypto';

// These tests exercise the real WebCrypto path (crypto.subtle, PBKDF2, AES-GCM).
// PBKDF2 at 150k iterations is run a handful of times, so give the suite headroom.

describe('deriveTopic', () => {
  it('is deterministic for the same passphrase', async () => {
    const a = await deriveTopic('correct horse battery staple');
    const b = await deriveTopic('correct horse battery staple');
    expect(a).toBe(b);
  });

  it('differs for a different passphrase', async () => {
    const a = await deriveTopic('passphrase one');
    const b = await deriveTopic('passphrase two');
    expect(a).not.toBe(b);
  });

  it('starts with the nexus7/ prefix and has the expected length', async () => {
    const t = await deriveTopic('anything');
    expect(t.startsWith('nexus7/')).toBe(true);
    // 'nexus7/' (7) + 24 hex chars = 31 chars total
    expect(t.length).toBe(31);
    expect(/^nexus7\/[0-9a-f]{24}$/.test(t)).toBe(true);
  });
});

describe('deriveKey + encryptMsg/decryptMsg round-trip', () => {
  it('round-trips the same {user,text,ts}', async () => {
    const key = await deriveKey('shared secret');
    const msg: ChatMessage = { user: 'deckard', text: 'wake up, time to die', ts: 1700000000000 };
    const payload = await encryptMsg(key, msg);

    expect(payload).toBeInstanceOf(Uint8Array);
    // 12-byte IV is prepended, so the payload is strictly longer than the IV.
    expect(payload.length).toBeGreaterThan(12);

    const out = await decryptMsg(key, payload);
    expect(out).toEqual(msg);
  });

  it('two encryptions of the same message differ (random IV) but both decrypt', async () => {
    const key = await deriveKey('shared secret');
    const msg: ChatMessage = { user: 'rachael', text: 'memories', ts: 42 };
    const p1 = await encryptMsg(key, msg);
    const p2 = await encryptMsg(key, msg);
    // ciphertext (and IV) should not be byte-identical
    expect(Buffer.from(p1).equals(Buffer.from(p2))).toBe(false);
    expect(await decryptMsg(key, p1)).toEqual(msg);
    expect(await decryptMsg(key, p2)).toEqual(msg);
  });

  it('a key from a DIFFERENT passphrase cannot decrypt (returns null)', async () => {
    const keyA = await deriveKey('passphrase A');
    const keyB = await deriveKey('passphrase B');
    const payload = await encryptMsg(keyA, { user: 'u', text: 'hi', ts: 1 });
    expect(await decryptMsg(keyB, payload)).toBeNull();
  });

  it('a truncated payload (<= IV length) returns null', async () => {
    const key = await deriveKey('p');
    expect(await decryptMsg(key, new Uint8Array(0))).toBeNull();
    expect(await decryptMsg(key, new Uint8Array(12))).toBeNull();
  });

  it('a tampered ciphertext returns null', async () => {
    const key = await deriveKey('p');
    const payload = await encryptMsg(key, { user: 'u', text: 't', ts: 1 });
    // Flip the last byte (inside the GCM auth tag / ciphertext) so verification fails.
    payload[payload.length - 1] ^= 0xff;
    expect(await decryptMsg(key, payload)).toBeNull();
  });
});

describe('normalizeMessage (exercised via decrypt)', () => {
  it('clamps an over-long user (>64) and text (>2000)', async () => {
    const key = await deriveKey('clamp test');
    const longUser = 'x'.repeat(200);
    const longText = 'y'.repeat(5000);
    const payload = await encryptMsg(key, { user: longUser, text: longText, ts: 99 });
    const out = await decryptMsg(key, payload);
    expect(out).not.toBeNull();
    expect(out!.user.length).toBe(64);
    expect(out!.text.length).toBe(2000);
    expect(out!.ts).toBe(99);
  });

  it('rejects a bad shape (missing/!string user or text) -> null', async () => {
    const key = await deriveKey('shape test');
    // Encrypt a structurally-bad object directly using the same AES-GCM scheme as
    // encryptMsg, so decryptMsg's normalizeMessage is what rejects it (not a
    // decryption failure).
    async function encryptRaw(obj: unknown): Promise<Uint8Array> {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plain = new TextEncoder().encode(JSON.stringify(obj));
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
      const cb = new Uint8Array(cipher);
      const out = new Uint8Array(iv.length + cb.length);
      out.set(iv, 0);
      out.set(cb, iv.length);
      return out;
    }

    expect(await decryptMsg(key, await encryptRaw({ user: 123, text: 'ok', ts: 1 }))).toBeNull();
    expect(await decryptMsg(key, await encryptRaw({ user: 'ok', ts: 1 }))).toBeNull();
    expect(await decryptMsg(key, await encryptRaw(null))).toBeNull();
    expect(await decryptMsg(key, await encryptRaw('just a string'))).toBeNull();
  });

  it('defaults a non-finite/absent ts to a finite number', async () => {
    const key = await deriveKey('ts test');
    async function encryptRaw(obj: unknown): Promise<Uint8Array> {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plain = new TextEncoder().encode(JSON.stringify(obj));
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
      const cb = new Uint8Array(cipher);
      const out = new Uint8Array(iv.length + cb.length);
      out.set(iv, 0);
      out.set(cb, iv.length);
      return out;
    }
    const out = await decryptMsg(key, await encryptRaw({ user: 'u', text: 't' }));
    expect(out).not.toBeNull();
    expect(out!.user).toBe('u');
    expect(out!.text).toBe('t');
    expect(Number.isFinite(out!.ts)).toBe(true);
  });
});
