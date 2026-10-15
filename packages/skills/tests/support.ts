import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type Files, treeHash } from '../src/hash'

const encoder = new TextEncoder()

/** A skill tree from text, as a fetch would hand it over. */
export const tree = (files: Record<string, string>): Files =>
  new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]))

export const skillMd = (front: string, body = 'Do the thing.\n'): string => `---\n${front}\n---\n${body}`

export const good = (name = 'my-skill'): Record<string, string> => ({
  'SKILL.md': skillMd(`name: ${name}\ndescription: Use when testing.\nlicense: MIT\nmetadata:\n  author: someone`),
})

/** Writes a local catalog of the given skills (id -> files) with correct pins, and returns its directory entries' tree hashes. */
export const writeCatalog = async (
  directory: string,
  skills: Record<string, Record<string, string>>,
  needs: Record<string, string[]> = {},
) => {
  const entries = []
  for (const [id, files] of Object.entries(skills)) {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(directory, 'skills', id, path)), { recursive: true })
      await writeFile(join(directory, 'skills', id, path), text)
    }
    entries.push({ id, source: { kind: 'althar' }, treeHash: treeHash(tree(files)), license: 'Apache-2.0', needs: needs[id] ?? [] })
  }
  await writeFile(join(directory, 'catalog.json'), JSON.stringify({ version: 1, revision: 'fixture-1', entries }))
}
