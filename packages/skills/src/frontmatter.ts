import { load } from 'js-yaml'

/** What a SKILL.md says about itself, before it is checked. */
export interface Frontmatter {
  readonly data: Readonly<Record<string, unknown>>
  readonly body: string
}

/** The YAML block between the leading `---` lines, and the Markdown after it; null when there is none or it is not a mapping. */
export const parseFrontmatter = (text: string): Frontmatter | null => {
  const lines = text.replace(/^﻿/, '').replaceAll('\r\n', '\n').split('\n')
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((line, at) => at > 0 && line.trim() === '---')
  if (end < 0) return null
  let data: unknown
  try {
    data = load(lines.slice(1, end).join('\n'))
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  return { data: data as Record<string, unknown>, body: lines.slice(end + 1).join('\n') }
}
