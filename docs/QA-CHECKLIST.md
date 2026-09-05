# NEXUS-7 manual QA checklist

Run this before every release. Unit tests and CI cover the data layer; this list covers what only a human running the real app can verify. Check each item on a `npm run dev` session, then repeat the boot and build items on the packaged exe.

## Boot and layout

- [ ] App boots with no console errors (open DevTools, check the console).
- [ ] App boots cleanly with NO `resources/seed-settings.json` present (falls back to defaults).
- [ ] All panels populate: both asset boxes show rows with prices, the BTC chart renders candles, the center command center shows the BTC price, the TOTAL cell, and the gold second-slot card, the news panel shows headlines, and the bottom ticker scrolls with coins.
- [ ] Fear and Greed index shows a value and a classification.
- [ ] Drag a panel to a new slot and resize the left-column boxes; layout persists after a restart.

## Globe and scenes

- [ ] Globe renders the Earth with dot-matrix continents (gold by day, cyan by night), city lights on the night side, the wireframe, live satellites and the ISS, and a star field behind it.
- [ ] Drag the globe to the night side: city lights are visible over the dark continents and fade out across the terminator.
- [ ] Scroll-zoom OUT runs through all 8 phases in order: Earth, cislunar (Moon), solar system, Milky Way, Local Group, universe, multiverse, and the terminal Stacked Branes view. Stars streak toward the center while the zoom is moving and settle when it stops; a ring pulse fires at each phase boundary.
- [ ] The SCALE line under the tag counts up (KM, AU, LY, MLY, GLY) as you pull back, then reads BEYOND THE HORIZON / OUTSIDE SPACETIME.
- [ ] The ladder on the right highlights the current phase; clicking a rung jumps to it; the wheel still zooms while the pointer is over the ladder.
- [ ] Cislunar: the Moon shows a glow, LUNA + live range, a motion trail, and L1/L2/L4/L5 markers. Solar: planets sit on their rings after a drag yaw, with motion trails, Saturn's ring, the asteroid belt, and all eight labels.
- [ ] Zoom back IN returns smoothly to Earth.

## Layout moves

- [ ] Drag the grip (top center of any panel) onto another panel: the two swap, state intact (chart keeps its candles, globe keeps spinning, chat stays connected).
- [ ] Drop the right-hand tabs panel onto the center column: the tabs fill the center, and the command center fits the top-right slot with COMMS still usable.
- [ ] Drop the command center into a left-column box: its graphic row collapses and the column scrolls so COMMS stays reachable.
- [ ] Move the chart anywhere: its title moves with it and the candles resize to the new slot.
- [ ] Hide the corner scene after a move: whichever slot holds it collapses to the SHOW strip, and the strip follows the scene through further swaps. SHOW restores the slot.
- [ ] Restart the app: the arrangement is restored. Settings > LAYOUT > reset puts everything back.
- [ ] Jukebox: Nightride FM is CH 01. Star a station: it is selected on the next open. Star it again to clear.
- [ ] Night City scene renders (animated noir skyline) and a single UFO flyover appears within a minute or so.

## Chat

- [ ] Chat connects: the status indicator goes green, the header reads PUBLIC ROOM, and a system line explains who can read the room.
- [ ] Titlebar LEDs turn green as sources load; hovering one shows the source and its last update. Double-clicking the titlebar maximizes / restores and the maximize button glyph follows.
- [ ] Public room: with a SECOND instance of NEXUS-7 running, send a message in the PUBLIC room from one instance and confirm it arrives in the other.
- [ ] Private room: switch to a private room, set a passphrase, and confirm a second instance with the SAME passphrase exchanges messages while one with a different passphrase sees nothing.

## Settings

- [ ] Settings gear opens the settings panel with COMMS, CHAOS, SCENES, LAYOUT, MEME IMAGES, and ABOUT sections.
- [ ] Change the callsign; the chat posts a system line and the next message carries the new name.
- [ ] Flip CRT scanlines off and on; the lines vanish and return without a restart. Flip Night City ULTRA (on by default); the scene remounts in normal noir and back.
- [ ] Reset panel arrangement after a drag-swap; panels return to their original slots.
- [ ] Add a custom image; it appears in the grid and joins the overlay pool.
- [ ] Remove a custom image; it is gone from the grid and the pool.
- [ ] Change assets in a box and the featured center asset; the change is reflected and persists after restart.

## Media tabs

- [ ] Jukebox: click Nightride FM (CH 01) and confirm audio plays and the equalizer animates. Pick another station and change the volume; after a restart the same station is selected (not playing) at the same volume.
- [ ] TV: Unmute brings audio up and the button becomes Mute; Mute silences it again.
- [ ] MONITOR tab: cams load for several presets (Tokyo, ISS live Earth, and at least one other).
- [ ] TV tab loads a live stream; Unmute brings up audio.
- [ ] At the minimum window size (1024x640) the COMMS message list is still visible and the emoji strip scrolls sideways instead of wrapping.

## Accessibility

- [ ] With OS "reduce motion" enabled, animations (globe spin, scenes, equalizer) respect reduced motion (snap or hold instead of animating).

## Packaged build

- [ ] `npm run build:exe` completes and produces `dist/NEXUS-7-<version>.exe` (the seed guard passes: no personal `resources/seed-settings.json` in place).
- [ ] Launching the exe a second time focuses the running window instead of opening a second copy.
- [ ] The packaged exe boots, populates panels, and chat connects (re-run the boot, panels, and chat items above on the exe).
