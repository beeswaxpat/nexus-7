// Encrypted-chat MQTT transport, running in the MAIN process. On some locked-down
// networks (corporate / government endpoint security) the Chromium RENDERER cannot
// open WSS connections to the public brokers on their non-standard ports (8084 /
// 8081) even though port 443 works and the MAIN process (Node) reaches them fine.
// So the transport lives here: the renderer derives the topic + key and does all
// AES-GCM crypto, then hands us only the OPAQUE base64 ciphertext to publish, and we
// hand received ciphertext back. We never see the passphrase, key, or plaintext.
//
// Wire format is identical to the renderer's browser path (mqtt.js over WSS,
// base64-text payloads), so a main-relay client and a browser/window.mqtt client
// interoperate in the same room. Resilience mirrors the renderer's mqtt-client:
// alternate brokers on every retry, fast first pass, and only surface 'error' after
// a sustained failure streak (otherwise show the optimistic 'connecting').

import type { BrowserWindow } from 'electron';
import mqtt, { type MqttClient as MqttJsClient, type IClientOptions } from 'mqtt';
import { IPC } from '../shared/ipc-channels';
import { MQTT_BROKERS } from '../shared/constants';

const CONNECT_TIMEOUT_MS = 12_000;
const FAST_RETRY_MS = 700;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const ERROR_AFTER_FAILS = 5;
// A legitimate chat message (base64 of IV + GCM ciphertext of a small JSON) is well
// under 1 KB; cap the wire payload generously to short-circuit broker firehose abuse.
const MAX_WIRE_BYTES = 16 * 1024;

type Status = 'connecting' | 'connected' | 'error';

export interface ChatRelay {
  connect(topic: string): void;
  publish(wireB64: string): void;
  disconnect(): void;
  dispose(): void;
}

/** Create the per-window chat relay. Sends CHAT_MESSAGE / CHAT_STATUS to the window. */
export function createChatRelay(win: BrowserWindow): ChatRelay {
  const brokers = MQTT_BROKERS.length > 0 ? [...MQTT_BROKERS] : [];
  let topic = '';
  let client: MqttJsClient | null = null;
  let brokerIndex = 0;
  let attempt = 0;
  let consecutiveFails = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clientId = 'nexus7main_' + Math.random().toString(16).slice(2, 10);

  const sendStatus = (s: Status): void => {
    if (!disposed && !win.isDestroyed()) win.webContents.send(IPC.CHAT_STATUS, s);
  };
  const sendMessage = (wireB64: string): void => {
    if (!disposed && !win.isDestroyed()) win.webContents.send(IPC.CHAT_MESSAGE, wireB64);
  };
  // Optimistic while still cycling brokers; red 'error' only after a real streak.
  const reportTrouble = (): void => sendStatus(consecutiveFails >= ERROR_AFTER_FAILS ? 'error' : 'connecting');

  const clearReconnect = (): void => {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const teardown = (): void => {
    if (!client) return;
    const c = client;
    client = null;
    try {
      c.removeAllListeners();
      c.end(true);
    } catch {
      /* already closing */
    }
  };

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer != null || !topic) return;
    brokerIndex = (brokerIndex + 1) % Math.max(1, brokers.length);
    const fastPass = Math.max(2, brokers.length * 2);
    const base =
      attempt < fastPass
        ? FAST_RETRY_MS
        : Math.min(BACKOFF_BASE_MS * 2 ** (attempt - fastPass), BACKOFF_MAX_MS);
    const jittered = base * (0.8 + Math.random() * 0.4);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, jittered);
  };

  const open = (): void => {
    if (disposed || !topic) return;
    if (brokers.length === 0) {
      sendStatus('error');
      return;
    }
    teardown();
    sendStatus('connecting');

    const url = brokers[brokerIndex];
    const options: IClientOptions = {
      clientId,
      clean: true,
      protocolVersion: 4,
      reconnectPeriod: 0,
      connectTimeout: CONNECT_TIMEOUT_MS,
      keepalive: 30,
      resubscribe: false
    };

    let c: MqttJsClient;
    try {
      c = mqtt.connect(url, options);
    } catch {
      consecutiveFails += 1;
      reportTrouble();
      scheduleReconnect();
      return;
    }
    client = c;

    c.on('connect', () => {
      if (disposed || client !== c) return;
      attempt = 0;
      consecutiveFails = 0;
      sendStatus('connected');
      c.subscribe(topic, { qos: 0 }, () => {
        /* a slow/failed SUBACK does not mean disconnected; keep the live connection */
      });
    });

    c.on('message', (_t, message) => {
      if (disposed || client !== c) return;
      try {
        const text = typeof message === 'string' ? message : message.toString('utf8');
        if (text.length === 0 || text.length > MAX_WIRE_BYTES) return;
        sendMessage(text);
      } catch {
        /* ignore malformed payloads */
      }
    });

    c.on('error', () => {
      if (disposed || client !== c) return;
      consecutiveFails += 1;
      teardown();
      reportTrouble();
      scheduleReconnect();
    });

    c.on('close', () => {
      if (disposed || client !== c) return;
      consecutiveFails += 1;
      reportTrouble();
      scheduleReconnect();
    });

    c.on('offline', () => {
      if (disposed || client !== c) return;
      reportTrouble();
    });
  };

  return {
    connect(t: string): void {
      if (disposed || typeof t !== 'string' || !t) return;
      topic = t;
      brokerIndex = 0;
      attempt = 0;
      consecutiveFails = 0;
      clearReconnect();
      open();
    },
    publish(wireB64: string): void {
      const c = client;
      if (!c || !c.connected || !topic) return;
      if (typeof wireB64 !== 'string' || wireB64.length === 0 || wireB64.length > MAX_WIRE_BYTES) return;
      try {
        c.publish(topic, wireB64, { qos: 0 });
      } catch {
        /* best-effort QoS 0 */
      }
    },
    disconnect(): void {
      topic = '';
      clearReconnect();
      teardown();
    },
    dispose(): void {
      disposed = true;
      topic = '';
      clearReconnect();
      teardown();
    }
  };
}
