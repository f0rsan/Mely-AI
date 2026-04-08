/**
 * charAccent.ts
 * Utilities for generating stable, deterministic per-character accent colors.
 *
 * Usage:
 *   import { getCharAccent, applyCharAccent } from "@/utils/charAccent";
 *
 *   // Get a stable HSL color from a character ID
 *   const accent = getCharAccent("c1"); // => "hsl(320, 70%, 65%)"
 *
 *   // Apply the accent as a CSS custom property to a DOM element
 *   applyCharAccent(containerRef.current, char.id);
 */

/**
 * Derives a stable HSL color string from a character ID string.
 * The same ID always produces the same hue via a simple polynomial hash.
 */
export function getCharAccent(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 65%)`;
}

/**
 * Sets --char-accent on the given element so CSS classes that reference
 * var(--char-accent) (e.g. .nav-item.active, .progress-fill) will pick up
 * the character-specific color automatically.
 */
export function applyCharAccent(element: HTMLElement | null, id: string): void {
  if (!element) return;
  element.style.setProperty("--char-accent", getCharAccent(id));
}
