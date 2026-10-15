import { type Files } from './hash'
import { type Finding } from './validate'

/** Instructions that would have an agent push or open a pull request itself; Althar pushes. */
const PUSHES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bgit\s+push\b/, 'tells the agent to run git push'],
  [/\bgh\s+pr\s+(?:create|merge)\b/, 'tells the agent to open or merge a pull request'],
  [/\bglab\s+mr\s+(?:create|merge)\b/, 'tells the agent to open or merge a merge request'],
]

/**
 * Text in a skill that undermines the no-push default. For the default catalog it rejects (such skills are
 * patched before they ship); for a person's own install it flags, and the boundary is Althar's push guard
 * and the harness's permission rules, not this lint.
 */
export const lintPushes = (files: Files, level: Finding['level']): Finding[] => {
  const decoder = new TextDecoder()
  const findings: Finding[] = []
  for (const path of [...files.keys()].toSorted()) {
    if (!path.endsWith('.md')) continue
    const text = decoder.decode(files.get(path)!)
    for (const [pattern, message] of PUSHES) {
      if (pattern.test(text)) findings.push({ level, code: 'pushes', message, path })
    }
  }
  return findings
}
