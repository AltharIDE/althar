import { byPath, type Files } from './hash'
import { type Finding } from './validate'

/** Instructions that would have an agent push or open a pull request itself; Althar pushes. */
const PUSHES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bgit\s+push\b/, 'tells the agent to run git push'],
  [/\bgh\s+pr\s+(?:create|merge)\b/, 'tells the agent to open or merge a pull request'],
  [/\bglab\s+mr\s+(?:create|merge)\b/, 'tells the agent to open or merge a merge request'],
]

const decoder = new TextDecoder('utf-8', { fatal: true })

/** A file's text, or null for one that is not UTF-8 text. */
const textOf = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null
  try {
    return decoder.decode(bytes)
  } catch {
    return null
  }
}

/**
 * Text in a skill that undermines the no-push default. For the default catalog it rejects (such skills are
 * patched before they ship); for a person's own install it flags, and the boundary is Althar's push guard
 * and the harness's permission rules, not this lint.
 */
export const lintPushes = (files: Files, level: Finding['level']): Finding[] => {
  const findings: Finding[] = []
  for (const [path, bytes] of [...files].toSorted(byPath)) {
    // Every text file, a script above all, as that is where a push is likeliest; a binary file is no instruction.
    const text = textOf(bytes)
    if (text === null) continue
    for (const [pattern, message] of PUSHES) {
      if (pattern.test(text)) findings.push({ level, code: 'pushes', message, path })
    }
  }
  return findings
}
