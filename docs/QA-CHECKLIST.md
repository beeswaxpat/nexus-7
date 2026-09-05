# NEXUS-7 manual QA checklist

Run this before every release. Unit tests and CI cover the data layer; this list covers what only a human running the real app can verify. Check each item on a `npm run dev` session, then repeat the boot and build items on the packaged exe.

## Boot and layout

- [ ] App boots with no console errors (open DevTools, check the console).
- [ ] App boots cleanly with NO `resources/seed-settings.json` present (falls back to defaults).
- [ ] All panels populate: both asset boxes show rows with prices, the BTC chart renders candles, the center command center shows the BTC price, the TOTAL cell, and the gold second-slot card, the news panel shows headlines, and the bottom ticker scrolls with coins.
- [ ] Fear and Greed index shows a value and a classification.
- [ ] Drag a panel to a new slot and resize the left-column boxes; layout persists after a restart.

## Globe and scenes

- [ ] Globe renders the wireframe Earth with live satellites and the ISS.
- [ ] Scroll-zoom OUT runs through all 8 phases in order: Earth, cislunar (Moon), solar system, Milky Way, Local Group, universe, multiverse, and the terminal Stacked Branes view.
- [ ] Zoom back IN returns smoothly to Earth.
- [ ] Night City scene renders (animated noir skyline) and a single UFO flyover appears within a minute or so.

## Chat

- [ ] Chat connects: the status indicator goes green.
- [ ] Public room: with a SECOND instance of NEXUS-7 running, send a message in the PUBLIC room from one instance and confirm it arrives in the other.
- [ ] Private room: switch to a private room, set a passphrase, and confirm a second instance with the SAME passphrase exchanges messages while one with a different passphrase sees nothing.

## Settings

- [ ] Settings gear opens the settings panel.
- [ ] Add a custom image; it appears in the grid and joins the overlay pool.
- [ ] Remove a custom image; it is gone from the grid and the pool.
- [ ] Change assets in a box and the featured center asset; the change is reflected and persists after restart.

## Media tabs

- [ ] Jukebox: click Chillsynth (CH 01) and confirm audio plays and the equalizer animates.
- [ ] MONITOR tab: cams load for several presets (New York, ISS live Earth, and at least one other).
- [ ] TV tab loads a live stream; Unmute brings up audio.
- [ ] At the minimum window size (1024x640) the COMMS message list is still visible and the emoji strip scrolls sideways instead of wrapping.

## Accessibility

- [ ] With OS "reduce motion" enabled, animations (globe spin, scenes, equalizer) respect reduced motion (snap or hold instead of animating).

## Packaged build

- [ ] `npm run build:exe` completes and produces `dist/NEXUS-7-<version>.exe` (the seed guard passes: no personal `resources/seed-settings.json` in place).
- [ ] Launching the exe a second time focuses the running window instead of opening a second copy.
- [ ] The packaged exe boots, populates panels, and chat connects (re-run the boot, panels, and chat items above on the exe).
