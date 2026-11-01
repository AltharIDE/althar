import type { Theme } from '../../lib/theme'
import type { DiagramColours, Drawn } from './drawDiagram'

/*
 * Mermaid, fetched the first time a diagram shows and kept: drawDiagram is
 * the only module that imports it, and only from here, so it is a chunk of
 * its own the window loads then and not before.
 */

export type { Drawn } from './drawDiagram'

let drawing: Promise<typeof import('./drawDiagram')> | null = null
const load = () => (drawing ??= import('./drawDiagram'))

/* the light theme's, for where the tokens aren't in the page (a test) */
const FALLBACK: Record<string, string> = {
  '--font': 'sans-serif',
  '--paper': '#ffffff',
  '--n-2': '#f4f2ec',
  '--n-3': '#fbfaf7',
  '--n-4': '#e7e3da',
  '--n-5': '#d6d1c6',
  '--t-1': '#141417',
  '--t-2': '#45454c',
  '--t-3': '#6f6f77',
}

/** The tokens as they show now: mermaid works its shades out from real colours, so it is given them, not the variables. */
const colours = (theme: Theme): DiagramColours => {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string) => css.getPropertyValue(name).trim() || (FALLBACK[name] ?? '')
  const dark = theme === 'dark'
  /* shapes sit a step off the sheet: darker on paper, lighter at night, where raised means lighter */
  return {
    dark,
    font: token('--font'),
    paper: token('--paper'),
    fill: token(dark ? '--n-4' : '--n-2'),
    edge: token('--n-5'),
    ink: token('--t-1'),
    ink2: token('--t-2'),
    line: token('--t-3'),
    fill2: token(dark ? '--n-5' : '--n-4'),
    fill3: token('--n-3'),
  }
}

/* what was drawn last, by theme and source: a message and the panel can show the same diagram, and a thread draws again as it scrolls back */
const kept = new Map<string, Promise<Drawn>>()
const KEPT = 24

/** The diagram the source says, in the theme showing; it fails with mermaid's error where the source isn't one. */
export function diagram(source: string, theme: Theme): Promise<Drawn> {
  const key = `${theme}\n${source}`
  const had = kept.get(key)
  if (had !== undefined) {
    kept.delete(key)
    kept.set(key, had)
    return had
  }
  const drawn = load().then((m) => m.drawDiagram(source, colours(theme)))
  kept.set(key, drawn)
  if (kept.size > KEPT) kept.delete(kept.keys().next().value as string)
  return drawn
}

/** Whether a fenced block names mermaid as its language. */
export const isDiagram = (lang: string | undefined) => lang?.trim().toLowerCase() === 'mermaid'

/** Whether a fenced block is closed: one still streaming in has no closing fence yet, and is shown as its source until it has. */
export const closedFence = (raw: string) => /(?:^|\n) {0,3}(?:`{3,}|~{3,})[ \t]*\n*$/.test(raw) && /\n/.test(raw.trimEnd())
