// IMPLEMENTED (Phase 2, Track C2). Wraps mqtt.js over WSS. Broker list lives in
// shared/constants.ts (MQTT_BROKERS: primary EMQX, fallback test.mosquitto.org).
// Connects to a derived topic, publishes/subscribes encrypted payloads, surfaces
// connection status, and reconnects with exponential backoff (retries the same
// broker once, then alternates on repeated failure). Runs in the RENDERER (the
// passphrase never reaches the main process). Signature FROZEN.
//
// Payloads cross this boundary as Uint8Array (the crypto module's IV+ciphertext).
// On the wire they are base64 text so any broker / QoS-0 transport carries them
// cleanly; we decode incoming payloads back to Uint8Array before onMessage.

// mqtt comes from the VENDORED UMD browser build (window.mqtt), loaded by a plain
// script tag in index.html before this module. The npm `import mqtt from 'mqtt'`
// does NOT survive Vite's production rollup bundling: the chat connects in dev:web
// but the packaged build silently never sends CONNECT and sits on "connecting"
// forever. The prebuilt browser bundle (mqtt/dist/mqtt.min.js) is self-contained
// and works in both dev and the exe. Only the TYPES are imported from the package.
import type { MqttClient as MqttJsClient, IClientOptions } from 'mqtt';

/** The slice of the mqtt API we use, read off the global UMD build. */
interface MqttApi {
  connect(url: string, opts: IClientOptions): MqttJsClient;
}

/** The vendored UMD build assigns `window.mqtt`; null until that script has run. */
function getMqtt(): MqttApi | null {
  const m = (globalThis as { mqtt?: MqttApi }).mqtt;
  return m && typeof m.connect === 'function' ? m : null;
}
import { MQTT_BROKERS } from '../../../shared/constants';
import { getBridge, type Bridge } from '../../bridge';

export type ConnectionStatus = 'connecting' | 'connected' | 'error';

export interface MqttClientOptions {
  topic: string;
  onMessage: (payload: Uint8Array) => void;
  onStatus: (status: ConnectionStatus) => void;
}

export interface MqttClient {
  /** Returns true if the payload was handed to a live connection (c.connected). */
  publish(payload: Uint8Array): boolean;
  disconnect(): void;
}

// Reconnect backoff bounds. We drive reconnection ourselves (mqtt's internal
// reconnectPeriod is disabled) so we can alternate brokers and grow the delay.
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const CONNECT_TIMEOUT_MS = 12_000;
// While still cycling through the broker list for the first time, retry fast so a
// healthy broker is found in ~1-2 s instead of after slow same-broker retries.
const FAST_RETRY_MS = 700;
// Only surface a red 'error' after this many consecutive failed connect attempts.
// Below it we keep showing the optimistic 'connecting', so a normal broker blip plus
// a successful reconnect never flashes ERROR at the user. Reset on every good CONNACK.
const ERROR_AFTER_FAILS = 5;

/**
 * Create a chat transport for the derived topic. PREFERS the MAIN-process MQTT relay
 * (exposed by the Electron preload bridge) so the chat works on networks where the
 * renderer cannot reach the brokers' non-443 ports (endpoint security / proxy);
 * the main process reaches them fine. Falls back to the in-renderer vendored mqtt.js
 * (window.mqtt) under dev:web or any host without the relay bridge. Both speak the
 * same base64 wire format, so relay clients and browser clients share a room.
 */
export function createMqttClient(opts: MqttClientOptions): MqttClient {
  const bridge = getBridge();
  if (
    bridge.chatConnect &&
    bridge.chatPublish &&
    bridge.chatDisconnect &&
    bridge.onChatMessage &&
    bridge.onChatStatus
  ) {
    return createRelayClient(bridge, opts);
  }
  return createBrowserClient(opts);
}

/**
 * MAIN-process relay transport. The renderer ships only opaque ciphertext (base64
 * wire text) and the derived topic over IPC; main owns the MQTT socket, broker
 * cycling, reconnection, and status. End-to-end crypto never leaves the renderer.
 */
function createRelayClient(bridge: Bridge, opts: MqttClientOptions): MqttClient {
  let status: ConnectionStatus = 'connecting';
  const offMsg = bridge.onChatMessage!((wireB64) => {
    if (wireB64.length > MAX_WIRE_BYTES) return; // same wire cap as the browser path
    const bytes = tryBase64(wireB64);
    if (!bytes) return; // not valid base64 / not our payload: ignore
    try {
      opts.onMessage(bytes);
    } catch (err) {
      console.error('[mqtt] onMessage handler threw', err);
    }
  });
  const offStatus = bridge.onChatStatus!((s) => {
    status = s;
    opts.onStatus(s);
  });
  bridge.chatConnect!(opts.topic);
  return {
    publish: (payload: Uint8Array): boolean => {
      try {
        bridge.chatPublish!(encodeWirePayload(payload));
      } catch {
        return false;
      }
      // A 'connected' status means main's socket is live (mirrors the browser path's
      // c.connected gate); QoS 0 has no delivery receipt either way.
      return status === 'connected';
    },
    disconnect: (): void => {
      try {
        bridge.chatDisconnect!();
      } catch {
        /* ignore */
      }
      offMsg();
      offStatus();
    }
  };
}

/** In-renderer transport using the vendored window.mqtt (dev:web / no relay bridge). */
function createBrowserClient(opts: MqttClientOptions): MqttClient {
  const brokers = MQTT_BROKERS.length > 0 ? [...MQTT_BROKERS] : [];
  let brokerIndex = 0;
  let attempt = 0;
  // Consecutive failed connect attempts since the last good CONNACK. Decides whether
  // a non-connected state shows as optimistic 'connecting' or red 'error'.
  let consecutiveFails = 0;
  let client: MqttJsClient | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // Stable per-session client id so brokers do not reject the WSS upgrade for an
  // empty/duplicate id. Random suffix avoids collisions between the two friends.
  const clientId = 'nexus7_' + Math.random().toString(16).slice(2, 10);

  const clearReconnect = (): void => {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const teardownClient = (): void => {
    if (!client) return;
    const c = client;
    client = null;
    try {
      c.removeAllListeners();
      c.end(true); // force-close, skip the graceful DISCONNECT handshake
    } catch {
      /* already closing; ignore */
    }
  };

  // Report a non-connected state to the UI: 'connecting' while we are still
  // optimistically cycling brokers, escalating to red 'error' only once attempts
  // have failed ERROR_AFTER_FAILS times in a row (a real, sustained outage).
  const reportTrouble = (): void => {
    if (disposed) return;
    opts.onStatus(consecutiveFails >= ERROR_AFTER_FAILS ? 'error' : 'connecting');
  };

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer != null) return;
    // Alternate broker on EVERY retry so a single dead broker is skipped within one
    // cycle (try the other one next) instead of wasting several retries on it.
    brokerIndex = (brokerIndex + 1) % Math.max(1, brokers.length);
    // First pass over the broker list retries fast (find a healthy broker quickly);
    // after that, exponential backoff with jitter up to the cap for a real outage.
    const fastPass = Math.max(2, brokers.length * 2);
    const base =
      attempt < fastPass
        ? FAST_RETRY_MS
        : Math.min(BACKOFF_BASE_MS * 2 ** (attempt - fastPass), BACKOFF_MAX_MS);
    const jittered = base * (0.8 + Math.random() * 0.4);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, jittered);
  };

  const connect = (): void => {
    if (disposed) return;
    if (brokers.length === 0) {
      opts.onStatus('error');
      return;
    }

    teardownClient();
    opts.onStatus('connecting');

    const mqtt = getMqtt();
    if (!mqtt) {
      // The vendored UMD script has not defined window.mqtt yet (or failed to load).
      console.warn('[mqtt] global mqtt build unavailable, will retry');
      consecutiveFails += 1;
      reportTrouble();
      scheduleReconnect();
      return;
    }

    const url = brokers[brokerIndex];
    const options: IClientOptions = {
      clientId,
      clean: true,
      protocolVersion: 4, // MQTT 3.1.1, broadest public-broker support over WSS
      reconnectPeriod: 0, // we manage reconnection (see scheduleReconnect)
      connectTimeout: CONNECT_TIMEOUT_MS,
      keepalive: 30,
      resubscribe: false
    };

    let c: MqttJsClient;
    try {
      c = mqtt.connect(url, options);
    } catch (err) {
      console.warn('[mqtt] connect threw, will retry', err);
      consecutiveFails += 1;
      reportTrouble();
      scheduleReconnect();
      return;
    }
    client = c;
    wireClient(c);
  };

  /** Attach all event handlers to a freshly created client. */
  const wireClient = (c: MqttJsClient): void => {
    c.on('connect', () => {
      if (disposed || client !== c) return;
      attempt = 0; // reset backoff on a good connection
      consecutiveFails = 0; // a good CONNACK clears the failure streak
      // The CONNACK is what "connected" means: the socket is up and publish/receive
      // work now. Drive the status off this event, NOT the SUBACK. On public brokers
      // the SUBACK can be slow or dropped, which would otherwise leave the badge stuck
      // on "connecting" forever even though messages flow fine.
      opts.onStatus('connected');
      const trySubscribe = (retry: boolean): void => {
        c.subscribe(opts.topic, { qos: 0 }, (err) => {
          if (disposed || client !== c) return;
          if (err) {
            // A slow/failed SUBACK does NOT mean we are disconnected: keep the live
            // connection and the "connected" status, just log it (optionally retry once).
            console.warn('[mqtt] subscribe failed, keeping connection', err);
            if (retry) trySubscribe(false);
          }
        });
      };
      trySubscribe(true);
    });

    c.on('message', (_topic, message) => {
      if (disposed || client !== c) return;
      const bytes = decodeWirePayload(message);
      if (bytes) {
        try {
          opts.onMessage(bytes);
        } catch (err) {
          console.error('[mqtt] onMessage handler threw', err);
        }
      }
    });

    c.on('error', (err) => {
      if (disposed || client !== c) return;
      console.warn('[mqtt] client error', err?.message ?? err);
      consecutiveFails += 1;
      teardownClient();
      reportTrouble(); // 'connecting' while we retry; 'error' only after a streak
      scheduleReconnect();
    });

    c.on('close', () => {
      if (disposed || client !== c) return;
      // A close without a prior 'error' (e.g. a dropped live connection) is a failure
      // too, but reportTrouble keeps it 'connecting' while the reconnect is in flight.
      consecutiveFails += 1;
      reportTrouble();
      scheduleReconnect();
    });

    c.on('offline', () => {
      if (disposed || client !== c) return;
      reportTrouble();
    });

    c.on('reconnect', () => {
      if (disposed || client !== c) return;
      // a fresh attempt is in flight; show "connecting" rather than a stale "error"
      opts.onStatus('connecting');
    });
  };

  const publish = (payload: Uint8Array): boolean => {
    const c = client;
    if (!c || !c.connected) return false; // best-effort QoS 0: drop if not connected
    try {
      c.publish(opts.topic, encodeWirePayload(payload), { qos: 0 });
      return true;
    } catch (err) {
      console.warn('[mqtt] publish failed', err);
      return false;
    }
  };

  const disconnect = (): void => {
    disposed = true;
    clearReconnect();
    teardownClient();
  };

  connect();
  return { publish, disconnect };
}

// --- wire encoding (Uint8Array <-> base64 text) -----------------------------

// Upper bound on a single incoming wire payload before we even attempt to decode
// it. On the PUBLIC room the topic and key are derivable from the bundled
// passphrase, so any actor on the broker can publish arbitrary bytes that decrypt
// successfully. A legitimate chat message is tiny (a JSON {user,text,ts} plus a
// 12-byte IV plus the GCM tag, base64-encoded: well under 1 KB), so a 16 KB
// ceiling is generous and short-circuits oversized publishes before any large
// TextDecoder / regex / base64 / decrypt / JSON.parse pass runs on the main thread.
// Both receive paths enforce this cap: the in-renderer browser path in
// decodeWirePayload, and the main-process relay path in createRelayClient.
const MAX_WIRE_BYTES = 16 * 1024;

/** Encode raw bytes to a base64 string for the MQTT payload. */
function encodeWirePayload(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000; // avoid call-stack limits on large args
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Decode an incoming MQTT payload (Buffer/Uint8Array/string) into a Uint8Array.
 * Our own messages are base64 text; if a stray non-base64 payload arrives we fall
 * back to its raw bytes so decryptMsg can simply reject it (returns null).
 */
function decodeWirePayload(message: unknown): Uint8Array | null {
  try {
    // Cheap byte cap at the wire boundary: bail before any decode/decrypt work so a
    // single oversized publish (or a flood of them) cannot thrash the renderer. The
    // base64 form is ~4/3 the size of the raw bytes, so a MAX_WIRE_BYTES string cap
    // still admits every legitimate (sub-1 KB) message with room to spare.
    if (typeof message === 'string') {
      if (message.length > MAX_WIRE_BYTES) return null;
      return base64ToBytes(message);
    }
    if (message instanceof Uint8Array) {
      if (message.length > MAX_WIRE_BYTES) return null;
      const text = new TextDecoder().decode(message);
      const decoded = tryBase64(text);
      return decoded ?? message;
    }
    return null;
  } catch {
    return null;
  }
}

function tryBase64(text: string): Uint8Array | null {
  const trimmed = text.trim();
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed)) return null;
  try {
    return base64ToBytes(trimmed);
  } catch {
    return null;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.trim());
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
