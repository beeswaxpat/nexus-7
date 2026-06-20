// Encrypted MQTT chat panel: status light, message list, input + Send, emoji
// quick-send (poop/rocket/crying x5), username + passphrase prompts (passphrase
// LOCAL ONLY, never logged/sent), optional auto-message when chaos.autoMessage.
// Uses createMqttClient + the crypto helpers. Signature FROZEN.
//
// ROOMS: a room IS a passphrase (everyone who types the same phrase derives the
// same key + hidden topic, so any number of people can share one room). The
// header button hops between your PRIVATE room (your saved passphrase) and the
// built-in PUBLIC room, whose phrase ships in the app: every NEXUS-7 user who
// joins it lands in the same chatroom. Messages there are readable by anyone
// running the app (the "encryption" key is public by definition); there is no
// history and no moderation. The room choice persists locally.
//
// Defensive throughout: also runs in a plain browser (dev:web) where crypto.subtle
// is available; the bridge/settings are mocked, so every ctx access is guarded.

import type { AppContext } from '../../app-context';
import { el, mount } from '../../core/dom';
import { formatAge } from '../../core/format';
import { deriveKey, deriveTopic, encryptMsg, decryptMsg } from './crypto';
import type { ChatMessage } from './crypto';
import { createMqttClient } from './mqtt-client';
import type { ConnectionStatus, MqttClient } from './mqtt-client';
import './chat-panel.css';

// localStorage key for the shared passphrase. LOCAL ONLY: never sent, never logged,
// never written to the persisted settings file.
const PASSPHRASE_KEY = 'nexus7.chat.passphrase';

// localStorage key for which room is active ('private' | 'public').
const ROOM_KEY = 'nexus7.chat.room';
type ChatRoom = 'private' | 'public';

// The PUBLIC room's shared phrase. Baked into the app on purpose: it is what
// makes the room public (every copy of NEXUS-7 derives the same topic + key).
const PUBLIC_PASSPHRASE = 'NEXUS-7 // PUBLIC SQUAWK BOX // v1';

// Quick-send emoji (sent repeated x3, like the old app).
const QUICK_EMOJI: ReadonlyArray<{ emoji: string; label: string }> = [
  { emoji: '\u{1F4A9}', label: 'poop' }, // pile of poo
  { emoji: '\u{1F680}', label: 'rocket' }, // rocket
  { emoji: '\u{1F62D}', label: 'crying' }, // loudly crying face
  { emoji: '\u{1F480}', label: 'skull' },
  { emoji: '\u{1F911}', label: 'money' },
  { emoji: '\u{1F631}', label: 'shocked' },
  { emoji: '\u{1F60F}', label: 'smug' },
  { emoji: '\u{1F336}\u{FE0F}', label: 'pepper' },
  { emoji: '\u{1F47D}', label: 'alien' },
  { emoji: '\u{1F525}', label: 'fire' }
];
const QUICK_REPEAT = 3;

// Optional chaos auto-message (default OFF). The old app shouted this on a timer.
const AUTO_MESSAGE_INTERVAL_MS = 15 * 60 * 1000;
const AUTO_MESSAGE_SUFFIX = ' NOT REAL';

// Cap rendered rows so a long-running session never grows unbounded.
const MAX_RENDERED = 300;

// Incoming flood guard. The public room rides a shared broker anyone can publish
// to, so a stranger could fire a firehose of payloads; each one would otherwise
// schedule an AES-GCM decrypt plus a DOM append and a forced reflow. We accept up
// to INCOMING_MAX messages per INCOMING_WINDOW_MS rolling window, then drop the
// rest until the window resets. The cap sits far above any human two-person
// cadence (including the quick-send emoji bursts, which are outbound anyway), so
// legitimate traffic is never throttled.
const INCOMING_WINDOW_MS = 2000;
const INCOMING_MAX = 30;

export function mountChatPanel(container: HTMLElement, ctx: AppContext): void {
  if (!container) return;

  // teardown any previous mount (re-mount safety)
  const host = container as HTMLElement & { __chatCleanup?: () => void };
  host.__chatCleanup?.();

  // --- runtime state -------------------------------------------------------
  let username = (ctx?.settings?.username ?? '').trim();
  let key: CryptoKey | null = null;
  let mqtt: MqttClient | null = null;
  let status: ConnectionStatus = 'connecting';
  let autoTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  // incoming flood-guard state: fixed-window counter over the receive path only
  let incomingWindowStart = 0;
  let incomingCount = 0;
  let incomingNotified = false;

  let room: ChatRoom = readRoom();

  // --- structure -----------------------------------------------------------
  const dot = el('span', { class: 'chat__dot', 'aria-hidden': 'true' });
  const statusText = el('span', { class: 'chat__status-text', text: 'connecting' });
  const roomBtn = el('button', {
    class: 'chat__btn chat__room',
    type: 'button'
  }) as HTMLButtonElement;
  const header = el('div', { class: 'chat__header' },
    el('span', { class: 'chat__title', text: 'COMMS' }),
    roomBtn,
    el('span', { class: 'chat__status' }, dot, statusText)
  );

  /** The button always offers the room you would hop TO. */
  function refreshRoomBtn(): void {
    const goingPublic = room === 'private';
    roomBtn.textContent = goingPublic ? 'PUBLIC CHAT' : 'PRIVATE CHAT';
    roomBtn.title = goingPublic
      ? 'Join the public room shared by every NEXUS-7 user'
      : 'Back to your private passphrase room';
  }
  refreshRoomBtn();

  roomBtn.addEventListener('click', () => {
    room = room === 'private' ? 'public' : 'private';
    saveRoom(room);
    refreshRoomBtn();
    // tear down the current socket and rejoin on the new topic/key
    stopAutoMessage();
    try {
      mqtt?.disconnect();
    } catch {
      /* ignore */
    }
    mqtt = null;
    key = null;
    // drop any pending passphrase prompt from the old room (its promise just
    // never resolves; the private path re-prompts fresh when needed)
    list.querySelectorAll('.chat__prompt').forEach((c) => c.remove());
    setStatus('connecting');
    addSystem(
      room === 'public'
        ? 'joining the PUBLIC room (visible to every NEXUS-7 user, no history)'
        : 'back to your PRIVATE room'
    );
    void connect();
  });

  const list = el('div', { class: 'chat__list', role: 'log', 'aria-live': 'polite' });

  const input = el('input', {
    class: 'chat__input',
    type: 'text',
    placeholder: 'transmit a message',
    autocomplete: 'off',
    spellcheck: true,
    'aria-label': 'Message'
  }) as HTMLInputElement;

  const sendBtn = el('button', {
    class: 'chat__btn chat__send',
    type: 'button',
    title: 'Send'
  }, 'Send') as HTMLButtonElement;

  const inputRow = el('div', { class: 'chat__input-row' }, input, sendBtn);

  // quick-send controls
  const quickRow = el('div', { class: 'chat__quick' });
  for (const q of QUICK_EMOJI) {
    const b = el('button', {
      class: 'chat__btn chat__quick-btn',
      type: 'button',
      title: `Send ${q.label} x${QUICK_REPEAT}`,
      'aria-label': `Send ${q.label} times ${QUICK_REPEAT}`
    }, q.emoji) as HTMLButtonElement;
    b.addEventListener('click', () => void send(q.emoji.repeat(QUICK_REPEAT)));
    quickRow.append(b);
  }

  const root = el('div', { class: 'chat' }, header, list, quickRow, inputRow);
  mount(container, root);

  // --- wire input ----------------------------------------------------------
  const submit = (): void => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    void send(text);
  };
  sendBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') {
      ev.preventDefault();
      submit();
    }
  });

  // --- status light --------------------------------------------------------
  function setStatus(next: ConnectionStatus): void {
    status = next;
    dot.classList.remove('is-connecting', 'is-connected', 'is-error');
    dot.classList.add(
      next === 'connected' ? 'is-connected' : next === 'error' ? 'is-error' : 'is-connecting'
    );
    statusText.textContent = next;
  }
  // Initial 'connecting' state is already reflected: status defaults to 'connecting'
  // and statusText is constructed with that text. The first real onStatus drives the dot.

  // --- message rendering ---------------------------------------------------
  function addSystem(text: string): void {
    const row = el('div', { class: 'chat__msg chat__msg--system' },
      el('span', { class: 'chat__text', text })
    );
    appendRow(row);
  }

  function addMessage(msg: ChatMessage): void {
    const mine = msg.user === username && username.length > 0;
    const row = el('div', {
      class: 'chat__msg' + (mine ? ' chat__msg--mine' : '')
    },
      el('div', { class: 'chat__meta' },
        el('span', { class: 'chat__user', text: msg.user || 'anon' }),
        el('span', { class: 'chat__time', text: formatAge(msg.ts) })
      ),
      el('span', { class: 'chat__text', text: msg.text })
    );
    appendRow(row);
  }

  function appendRow(row: HTMLElement): void {
    // autoscroll only if the user is already near the bottom
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.append(row);
    while (list.childElementCount > MAX_RENDERED && list.firstElementChild) {
      list.firstElementChild.remove();
    }
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }

  // --- send path -----------------------------------------------------------
  async function send(text: string): Promise<void> {
    const body = (text ?? '').trim();
    if (!body || disposed) return;

    // first-send: ensure we have a username
    if (!username) {
      const name = await promptUsername();
      if (!name) return;
      username = name;
      persistUsername(name);
    }
    if (!key || !mqtt) {
      addSystem('not connected yet, message not sent');
      return;
    }

    const msg: ChatMessage = { user: username, text: body, ts: Date.now() };
    try {
      const payload = await encryptMsg(key, msg);
      // A successful publish only happens on a live connection (c.connected), so
      // correct the badge if it is lagging behind a slow/dropped SUBACK.
      const published = mqtt.publish(payload);
      if (published && status !== 'connected') setStatus('connected');
      // optimistic local echo (QoS 0 has no delivery receipt, and most public
      // brokers do not echo a client's own publish back to it)
      addMessage(msg);
    } catch (err) {
      console.error('[chat] encrypt/publish failed', err);
      addSystem('could not send that message');
    }
  }

  // --- incoming ------------------------------------------------------------
  async function onPayload(payload: Uint8Array): Promise<void> {
    if (!key || disposed) return;
    // fixed-window flood guard: drop excess incoming payloads before paying for a
    // decrypt + DOM append when the broker is firehosing the public topic
    const now = Date.now();
    if (now - incomingWindowStart >= INCOMING_WINDOW_MS) {
      incomingWindowStart = now;
      incomingCount = 0;
      incomingNotified = false;
    }
    incomingCount++;
    if (incomingCount > INCOMING_MAX) {
      // surface at most one notice per window, then stay quiet until it resets
      if (!incomingNotified) {
        incomingNotified = true;
        addSystem('incoming messages rate-limited');
      }
      return;
    }
    const msg = await decryptMsg(key, payload);
    if (!msg) return; // wrong passphrase / not our payload: ignore silently
    // We just received and decrypted a real message, so we are definitely connected.
    // If the badge is lagging on "connecting"/"error" (e.g. a slow/dropped SUBACK),
    // correct it now that traffic is proven to flow.
    if (status !== 'connected') setStatus('connected');
    // ignore our own echo if a broker happens to reflect it (we already echoed)
    if (msg.user === username && username.length > 0) return;
    addMessage(msg);
  }

  // --- connection bootstrap -----------------------------------------------
  async function connect(): Promise<void> {
    // the public room never prompts: its phrase is baked into the app
    const passphrase = room === 'public' ? PUBLIC_PASSPHRASE : await ensurePassphrase();
    if (!passphrase || disposed) {
      setStatus('error');
      addSystem('no passphrase set, chat is offline');
      return;
    }

    let topic: string;
    try {
      key = await deriveKey(passphrase);
      topic = await deriveTopic(passphrase);
    } catch (err) {
      console.error('[chat] key/topic derivation failed', err);
      setStatus('error');
      addSystem('could not derive the chat key');
      return;
    }
    if (disposed) return;

    mqtt = createMqttClient({
      topic,
      onMessage: (payload) => void onPayload(payload),
      onStatus: (s) => setStatus(s)
    });

    startAutoMessage();
  }

  // --- optional chaos auto-message ----------------------------------------
  function startAutoMessage(): void {
    stopAutoMessage();
    if (!ctx?.settings?.chaos?.autoMessage) return;
    autoTimer = setInterval(() => {
      if (!username) return; // never auto-send before a username exists
      void send(username + AUTO_MESSAGE_SUFFIX);
    }, AUTO_MESSAGE_INTERVAL_MS);
  }
  function stopAutoMessage(): void {
    if (autoTimer != null) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  // --- prompts -------------------------------------------------------------

  /** Read the saved passphrase, or show the first-run inline prompt to set one. */
  async function ensurePassphrase(): Promise<string | null> {
    const saved = readPassphrase();
    if (saved) return saved;
    const entered = await promptPassphrase();
    if (entered) savePassphrase(entered);
    return entered;
  }

  /**
   * Inline first-run passphrase prompt rendered INTO the message list area:
   * masked field with a reveal toggle, persisted to localStorage only.
   */
  function promptPassphrase(): Promise<string | null> {
    return new Promise((resolve) => {
      const field = el('input', {
        class: 'chat__prompt-input',
        type: 'password',
        placeholder: 'shared passphrase',
        autocomplete: 'off',
        spellcheck: false,
        'aria-label': 'Shared passphrase'
      }) as HTMLInputElement;

      const reveal = el('button', {
        class: 'chat__btn chat__reveal',
        type: 'button',
        title: 'Show or hide the passphrase',
        'aria-label': 'Toggle passphrase visibility'
      }, 'Show') as HTMLButtonElement;
      reveal.addEventListener('click', () => {
        const showing = field.type === 'text';
        field.type = showing ? 'password' : 'text';
        reveal.textContent = showing ? 'Show' : 'Hide';
        field.focus();
      });

      const ok = el('button', {
        class: 'chat__btn chat__prompt-ok',
        type: 'button'
      }, 'Connect') as HTMLButtonElement;

      const card = el('div', { class: 'chat__prompt' },
        el('div', { class: 'chat__prompt-title', text: 'Enter the shared passphrase' }),
        el('div', {
          class: 'chat__prompt-note',
          text: 'Both of you type the same phrase. Stored on this device only, never sent.'
        }),
        el('div', { class: 'chat__prompt-row' }, field, reveal),
        ok
      );

      const finish = (value: string | null): void => {
        card.remove();
        resolve(value);
      };
      ok.addEventListener('click', () => finish(field.value.trim() || null));
      field.addEventListener('keydown', (ev) => {
        if ((ev as KeyboardEvent).key === 'Enter') {
          ev.preventDefault();
          finish(field.value.trim() || null);
        }
      });

      list.append(card);
      list.scrollTop = list.scrollHeight;
      field.focus();
    });
  }

  /** Inline username prompt (first send). Persisted via settings + a local cache. */
  function promptUsername(): Promise<string | null> {
    return new Promise((resolve) => {
      const field = el('input', {
        class: 'chat__prompt-input',
        type: 'text',
        placeholder: 'callsign',
        autocomplete: 'off',
        maxlength: '24',
        'aria-label': 'Username'
      }) as HTMLInputElement;

      const ok = el('button', {
        class: 'chat__btn chat__prompt-ok',
        type: 'button'
      }, 'Set') as HTMLButtonElement;

      const card = el('div', { class: 'chat__prompt' },
        el('div', { class: 'chat__prompt-title', text: 'Pick a callsign' }),
        el('div', { class: 'chat__prompt-note', text: 'Shown next to your messages.' }),
        el('div', { class: 'chat__prompt-row' }, field, ok)
      );

      const finish = (value: string | null): void => {
        card.remove();
        resolve(value);
      };
      ok.addEventListener('click', () => finish(field.value.trim().slice(0, 24) || null));
      field.addEventListener('keydown', (ev) => {
        if ((ev as KeyboardEvent).key === 'Enter') {
          ev.preventDefault();
          finish(field.value.trim().slice(0, 24) || null);
        }
      });

      list.append(card);
      list.scrollTop = list.scrollHeight;
      field.focus();
    });
  }

  function persistUsername(name: string): void {
    // canonical store is settings; tolerate failure (dev:web / odd contexts)
    try {
      if (ctx?.updateSettings) void ctx.updateSettings({ username: name }).catch(() => {});
    } catch {
      /* best-effort */
    }
  }

  // --- teardown ------------------------------------------------------------
  host.__chatCleanup = () => {
    disposed = true;
    stopAutoMessage();
    try {
      mqtt?.disconnect();
    } catch {
      /* ignore */
    }
    mqtt = null;
    key = null;
  };

  // go
  void connect();
}

// --- module helpers ---------------------------------------------------------

/**
 * Read the active room. Defaults to 'public' so the chat connects on first launch
 * (no passphrase coordination needed); an explicit prior choice of 'private' is
 * honored. The private room is the passphrase-gated channel the user opts into.
 */
function readRoom(): ChatRoom {
  try {
    return localStorage.getItem(ROOM_KEY) === 'private' ? 'private' : 'public';
  } catch {
    return 'public';
  }
}

function saveRoom(room: ChatRoom): void {
  try {
    localStorage.setItem(ROOM_KEY, room);
  } catch {
    /* storage may be unavailable; the room just will not persist */
  }
}

/** Read the locally stored passphrase (localStorage only). */
function readPassphrase(): string {
  try {
    return (localStorage.getItem(PASSPHRASE_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

function savePassphrase(value: string): void {
  try {
    localStorage.setItem(PASSPHRASE_KEY, value);
  } catch {
    /* storage may be unavailable; chat just will not persist the phrase */
  }
}

