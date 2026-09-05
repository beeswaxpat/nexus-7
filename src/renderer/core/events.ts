// Window CustomEvent names used for cross-panel signals. Panels never import each
// other; a change made in one place (the Settings modal, a picker, a row editor)
// is broadcast on window and the interested panels re-read ctx.settings. Keep the
// names here so a typo cannot silently break a listener.

/** Fired after the center (featured) asset key changed. */
export const CENTER_CHANGED = 'nexus:center-changed';
/** Fired after the gold second-slot asset key changed. */
export const SECONDARY_CHANGED = 'nexus:secondary-changed';
/** Fired (bubbling, from a row) after a holdings quantity persisted. */
export const HOLDINGS_CHANGED = 'nexus:holdings-changed';
/** Fired after the user's image pool changed. */
export const IMAGES_CHANGED = 'nexus:images-changed';
/** Fired after settings.chaos changed (banners / scanlines / center text / auto message). */
export const CHAOS_CHANGED = 'nexus:chaos-changed';
/** Fired after settings.scenes changed from outside the scene manager. */
export const SCENES_CHANGED = 'nexus:scenes-changed';
/** Fired after settings.username changed; detail: { name }. */
export const USERNAME_CHANGED = 'nexus:username-changed';
/** Ask the chat to forget the stored private-room passphrase (and re-prompt if needed). */
export const PASSPHRASE_RESET = 'nexus:passphrase-reset';
/** Ask layout-swap to put every panel back in its original slot. */
export const LAYOUT_RESET = 'nexus:layout-reset';
/** Ask col-resize to restore the default left-column box weights. */
export const LEFTFLEX_RESET = 'nexus:leftflex-reset';

/** Broadcast a window CustomEvent (no-op outside a DOM). */
export function emit(name: string, detail?: unknown): void {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* non-DOM host */
  }
}
