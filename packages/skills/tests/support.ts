import { type Files } from '../src/hash'

const encoder = new TextEncoder()

/** A skill tree from text, as a fetch would hand it over. */
export const tree = (files: Record<string, string>): Files =>
  new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]))

export const skillMd = (front: string, body = 'Do the thing.\n'): string => `---\n${front}\n---\n${body}`

export const good = (name = 'my-skill'): Record<string, string> => ({
  'SKILL.md': skillMd(`name: ${name}\ndescription: Use when testing.\nlicense: MIT\nmetadata:\n  author: someone`),
})
