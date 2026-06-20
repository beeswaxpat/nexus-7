# Security Policy

## Reporting a vulnerability

If you find a security issue in NEXUS-7, please report it privately rather than opening a public issue.

- Open a GitHub security advisory on this repository (Security tab, "Report a vulnerability"), or
- Contact the maintainer directly through their GitHub profile (beeswaxpat).

Please include steps to reproduce, the affected version, and the potential impact. We will acknowledge the report and work on a fix. Please give us a reasonable window to address the issue before any public disclosure.

## Scope and known design tradeoffs

NEXUS-7 is a desktop dashboard that fetches public market data and runs a peer chat. A few things are intentional design tradeoffs, not vulnerabilities:

- Public chat room: NEXUS-7 ships with a built-in PUBLIC chat room whose key is baked into the app. This is what makes the room public: every copy of NEXUS-7 derives the same encryption key and topic, so any message sent there is readable by anyone running NEXUS-7. There is no history and no moderation. Do not put anything sensitive in the public room. For private conversations, use a PRIVATE room with a passphrase shared out of band. Private rooms use AES-GCM with a key and topic derived from the passphrase via PBKDF2 (WebCrypto); the passphrase stays local and is never transmitted or logged.
- Embedded remote content: the TV, Video, and MONITOR tabs embed remote YouTube iframes. A Content-Security-Policy in `src/renderer/index.html` restricts `frame-src` to the YouTube embed origins.
- Public MQTT brokers: chat connects to public MQTT brokers over WSS (EMQX and a mosquitto fallback). These are shared, unauthenticated brokers. Message contents are encrypted client-side before they leave your machine, so a broker only sees ciphertext, but connection metadata (that a client is connected to a topic) is visible to the broker operator.
- No code signing: the portable Windows build is not code signed, so Windows SmartScreen may warn on first run. Download release builds only from this repository's Releases page.

## What is in scope

Genuine vulnerabilities are in scope, for example: a way to read PRIVATE room messages without the passphrase, a way to break out of the renderer sandbox, remote code execution via crafted data from a feed or a chat message, or a path that leaks the local passphrase off the machine. Reports of these are very welcome.
