// Scene manager: the two ambient graphics (GLOBE and NIGHT CITY) are
// user-arrangeable. Either one can sit in the big center cell with the other in
// the corner panel (swap), and each can be hidden independently. The choice
// persists in Settings.scenes. Each slot gets a small hover control cluster
// (swap / hide / ULTRA); the graphics modules themselves stay unaware of all
// this. NOTE: the internal SceneId value 'wormhole' is kept verbatim (persisted
// settings keys depend on it); only the user-facing name changed to GLOBE.
//
// The two hosts created here are PERSISTENT wrapper nodes: layout-swap tags the
// corner wrapper as the panel content and may re-parent it whole, so re-renders
// here always target the wrapper, never a fixed grid cell.

import './scenes.css';
import { defaultSettings } from '../../shared/constants';
import type { AppContext } from '../app-context';
import type { SceneSettings } from '../../shared/types';
import { el } from './dom';
import { mountGlobe } from '../panels/globe/globe';
import { mountNightCity } from '../panels/noir/night-city';

type SceneId = 'wormhole' | 'nightcity';

const SCENE_NAME: Record<SceneId, string> = {
  wormhole: 'GLOBE',
  nightcity: 'NIGHT CITY'
};

export function mountScenes(
  centerCell: HTMLElement,
  cornerPanel: HTMLElement,
  ctx: AppContext
): void {
  const centerHost = el('div', { class: 'scn-slot scn-slot--center' });
  const cornerHost = el('div', { class: 'scn-slot scn-slot--corner' });
  centerCell.replaceChildren(centerHost);
  cornerPanel.replaceChildren(cornerHost);

  const disposers = new Map<HTMLElement, () => void>();

  // Fall back to the shipped defaults (read once) so dev:web mocks and a fresh
  // real profile start from the same scene arrangement instead of diverging.
  const defScenes = defaultSettings().scenes;
  const cfg = (): SceneSettings => ({
    swapped: ctx.settings?.scenes?.swapped ?? defScenes.swapped,
    showWormhole: ctx.settings?.scenes?.showWormhole ?? defScenes.showWormhole,
    showNightCity: ctx.settings?.scenes?.showNightCity ?? defScenes.showNightCity,
    ultra: ctx.settings?.scenes?.ultra ?? defScenes.ultra,
    ultraCity: ctx.settings?.scenes?.ultraCity ?? defScenes.ultraCity
  });

  const sceneFor = (host: HTMLElement): SceneId => {
    const inCenter = host === centerHost;
    return inCenter !== cfg().swapped ? 'wormhole' : 'nightcity';
  };

  const hostFor = (id: SceneId): HTMLElement =>
    sceneFor(centerHost) === id ? centerHost : cornerHost;

  async function patch(p: Partial<SceneSettings>): Promise<void> {
    const next = { ...cfg(), ...p };
    try {
      ctx.settings = await ctx.updateSettings({ scenes: next });
    } catch {
      // persist failed (dev:web edge): still apply in memory so the UI responds
      ctx.settings = { ...ctx.settings, scenes: next };
    }
  }

  /** Reclaim layout space in the DEFAULT arrangement when a scene is hidden. */
  function reclaim(host: HTMLElement, hidden: boolean): void {
    if (host === centerHost) {
      centerCell.closest('.cc')?.classList.toggle('cc--scene-hidden', hidden);
    } else {
      const p = cornerHost.parentElement;
      if (p && p.classList.contains('panel--chat')) {
        p.classList.toggle('panel--scene-hidden', hidden);
      }
    }
  }

  function controls(host: HTMLElement, id: SceneId, hidden: boolean): HTMLElement {
    const cluster = el('div', { class: 'scn-ctl' });

    if (!hidden && id === 'nightcity') {
      // only the night city scene has an ULTRA mode (synthwave inversion); the
      // GLOBE has no ULTRA button (its default render is the only one).
      const ultraKey: keyof SceneSettings = 'ultraCity';
      const ultraOn = cfg()[ultraKey];
      const offTitle = 'Invert into synthwave';
      const ultra = el('button', {
        class: `scn-btn scn-btn--ultra${ultraOn ? ' scn-btn--on' : ''}`,
        type: 'button',
        text: 'ULTRA',
        title: ultraOn ? `Back to normal ${SCENE_NAME[id]}` : offTitle
      });
      ultra.addEventListener('click', () => {
        void patch({ [ultraKey]: !cfg()[ultraKey] }).then(() => renderSlot(hostFor(id)));
      });
      cluster.append(ultra);
    }

    const swap = el('button', {
      class: 'scn-btn',
      type: 'button',
      text: '⇄',
      title: 'Swap with the other graphic',
      'aria-label': 'Swap the two graphics'
    });
    swap.addEventListener('click', () => {
      void patch({ swapped: !cfg().swapped }).then(renderAll);
    });

    const visKey: keyof SceneSettings = id === 'wormhole' ? 'showWormhole' : 'showNightCity';
    const vis = el('button', {
      class: 'scn-btn',
      type: 'button',
      text: hidden ? '◉' : '✕',
      title: hidden ? `Show ${SCENE_NAME[id]}` : `Hide ${SCENE_NAME[id]}`,
      'aria-label': hidden ? `Show ${SCENE_NAME[id]}` : `Hide ${SCENE_NAME[id]}`
    });
    vis.addEventListener('click', () => {
      void patch({ [visKey]: hidden }).then(() => renderSlot(host));
    });

    cluster.append(swap, vis);
    return cluster;
  }

  function renderSlot(host: HTMLElement): void {
    disposers.get(host)?.();
    disposers.delete(host);

    const id = sceneFor(host);
    const c = cfg();
    const hidden = id === 'wormhole' ? !c.showWormhole : !c.showNightCity;
    host.replaceChildren();
    host.classList.toggle('scn-slot--off', hidden);
    reclaim(host, hidden);

    if (hidden) {
      const show = el('button', {
        class: 'scn-show',
        type: 'button',
        text: `SHOW ${SCENE_NAME[id]}`
      });
      show.addEventListener('click', () => {
        const visKey = id === 'wormhole' ? 'showWormhole' : 'showNightCity';
        void patch({ [visKey]: true }).then(() => renderSlot(host));
      });
      host.append(el('div', { class: 'scn-hidden-note' }, show));
      return;
    }

    const stage = el('div', { class: 'scn-stage' });
    host.append(stage);
    if (id === 'wormhole') {
      mountGlobe(stage, ctx);
      const gl = stage.querySelector<HTMLElement & { dispose?: () => void }>('.globe');
      disposers.set(host, () => gl?.dispose?.());
    } else {
      mountNightCity(stage, ctx);
      const h = stage as HTMLElement & { __ncityDispose?: () => void };
      disposers.set(host, () => h.__ncityDispose?.());
    }
    host.append(controls(host, id, hidden));
  }

  function renderAll(): void {
    renderSlot(centerHost);
    renderSlot(cornerHost);
  }

  renderAll();
}
