// Scrappy: this repository's own package.json scripts, read as they are, to pick one to run.
const manifests = import.meta.glob<{ name: string; scripts?: Record<string, string> }>(
  ['../../../../package.json', '../../../../apps/*/package.json', '../../../../packages/*/package.json'],
  { eager: true, import: 'default' },
)

export interface Script {
  readonly id: string
  /** The package it is in: althar at the root, @althar/ui in a workspace. */
  readonly pkg: string
  readonly name: string
  /** What the script itself says. */
  readonly body: string
  /** How Althar would run it from the repository's root. */
  readonly command: string
}

const ROOT = '../../../../package.json'

/** Scripts that serve something, which most often want running: first in the list. */
const SERVES = /^(dev|start|serve|storybook|preview|site)$/

/** The root's first, then each workspace's; the ones only an install or a hook runs left out. */
export const SCRIPTS: ReadonlyArray<Script> = Object.entries(manifests)
  .sort(([a], [b]) => (a === ROOT ? -1 : b === ROOT ? 1 : a.localeCompare(b)))
  .flatMap(([path, manifest]) =>
    Object.entries(manifest.scripts ?? {})
      .filter(([name]) => name !== 'prepare')
      .map(([name, body]) => ({
        id: `${manifest.name}:${name}`,
        pkg: manifest.name,
        name,
        body,
        command: path === ROOT ? `bun run ${name}` : `bun --filter ${manifest.name} ${name}`,
      })),
  )
  .sort((a, b) => Number(!SERVES.test(a.name)) - Number(!SERVES.test(b.name)))

/** A script's name as a runnable would take it: Storybook for storybook, Pitch images for images. */
export const nameOf = (script: Script) => {
  const words = script.name.replace(/[:_-]+/g, ' ')
  const named = words.charAt(0).toUpperCase() + words.slice(1)
  return script.pkg === 'althar' || script.name === 'storybook' ? named : `${named} · ${script.pkg.replace('@althar/', '')}`
}
