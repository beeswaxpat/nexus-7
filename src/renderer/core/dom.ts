// Minimal DOM helpers so panels stay framework-free and terse.

type Attrs = Record<string, string | number | boolean | undefined>;

/**
 * Create an element. `attrs.class`/`className` set the class, `attrs.text` sets
 * textContent, `data-*` and aria-* pass through. Children may be nodes or strings.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

/** Resolve a container from an element or a selector. Throws if not found. */
export function resolve(target: HTMLElement | string): HTMLElement {
  if (typeof target !== 'string') return target;
  const found = document.querySelector<HTMLElement>(target);
  if (!found) throw new Error(`mount target not found: ${target}`);
  return found;
}

/** Clear a container and append nodes. Returns the container. */
export function mount(target: HTMLElement | string, ...nodes: Node[]): HTMLElement {
  const host = resolve(target);
  host.replaceChildren(...nodes);
  return host;
}

/** Remove all children. */
export function clear(target: HTMLElement | string): void {
  resolve(target).replaceChildren();
}
