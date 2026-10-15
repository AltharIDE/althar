import { type Files } from './hash'
import { parseFrontmatter } from './frontmatter'
import { lintPushes } from './lint'

/** Why a skill was refused, or what a person should look at on its review card. */
export interface Finding {
  readonly level: 'reject' | 'flag'
  readonly code: string
  readonly message: string
  readonly path?: string
}

export interface Limits {
  readonly files: number
  readonly bytes: number
  readonly fileBytes: number
}

export const DEFAULT_LIMITS: Limits = { files: 200, bytes: 5 * 1024 * 1024, fileBytes: 1024 * 1024 }

/** Fields the Agent Skills specification defines. */
const SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'])

/**
 * Fields that grant a harness something. Claude Code takes `allowed-tools` as a pre-approval and
 * registers `hooks` for the session; Althar installs neither (docs/plans/skills-across-harnesses.md, section 3).
 */
const AUTHORIZING = new Map([
  ['allowed-tools', 'pre-approves tools for the turn that invokes the skill'],
  ['hooks', 'registers hooks that run for the rest of the session'],
])

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A path that stays inside the skill: relative, forward slashes, no `..`, no empty or NUL parts. */
export const isSafePath = (path: string): boolean =>
  path.length > 0 &&
  !path.includes('\0') &&
  !path.includes('\\') &&
  !path.startsWith('/') &&
  !/^[A-Za-z]:/.test(path) &&
  path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')

const looksExecutable = (path: string): boolean =>
  /\.(sh|bash|zsh|js|cjs|mjs|ts|py|rb|pl|ps1|bat|cmd)$/.test(path) || /(^|\/)scripts\//.test(path)

export interface Checked {
  readonly name: string | null
  readonly description: string | null
  readonly license: string | null
  readonly findings: ReadonlyArray<Finding>
  /** Whether nothing rejects it. A flagged skill can still install once a person has read the flags. */
  readonly ok: boolean
}

/** Checks a fetched skill, held in memory, against the Agent Skills rules and Althar's. Runs nothing in it. */
export const validateSkill = (
  directory: string,
  files: Files,
  limits: Limits = DEFAULT_LIMITS,
  /** How serious push instructions in the text are: `reject` for the default catalog, `flag` for a person's own install. */
  pushes: Finding['level'] = 'flag',
): Checked => {
  const findings: Finding[] = []
  const reject = (code: string, message: string, path?: string) =>
    findings.push({ level: 'reject', code, message, ...(path === undefined ? {} : { path }) })
  const flag = (code: string, message: string, path?: string) =>
    findings.push({ level: 'flag', code, message, ...(path === undefined ? {} : { path }) })

  let bytes = 0
  if (files.size > limits.files) reject('too-many-files', `${files.size} files; at most ${limits.files}`)
  for (const [path, content] of files) {
    bytes += content.byteLength
    if (!isSafePath(path)) reject('unsafe-path', 'the path leaves the skill or is not a plain relative path', path)
    if (content.byteLength > limits.fileBytes) reject('file-too-large', `larger than ${limits.fileBytes} bytes`, path)
    if (looksExecutable(path)) flag('executable', 'a script; Althar never runs it, the agent might', path)
  }
  if (bytes > limits.bytes) reject('too-large', `${bytes} bytes in all; at most ${limits.bytes}`)

  findings.push(...lintPushes(files, pushes))

  const skill = files.get('SKILL.md')
  if (skill === undefined) {
    reject('no-skill-md', 'SKILL.md is missing')
    return { name: null, description: null, license: null, findings, ok: false }
  }
  const parsed = parseFrontmatter(new TextDecoder().decode(skill))
  if (parsed === null) {
    reject('bad-frontmatter', 'SKILL.md does not start with a YAML block between --- lines')
    return { name: null, description: null, license: null, findings, ok: false }
  }
  const { data } = parsed

  const name = typeof data.name === 'string' ? data.name : null
  if (name === null) reject('no-name', '`name` is required and must be text')
  else if (name.length > 64 || !NAME.test(name)) {
    reject('bad-name', '`name` is 1-64 lowercase letters, digits and single hyphens')
  } else if (name !== directory) reject('name-mismatch', `\`name\` is "${name}" but the directory is "${directory}"`)

  const description = typeof data.description === 'string' ? data.description.trim() : null
  if (description === null || description === '') reject('no-description', '`description` is required and must be text')
  else if (description.length > 1024) reject('long-description', '`description` is over 1024 characters')

  const { metadata } = data
  if (metadata !== undefined) {
    const plain = typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
    if (!plain || Object.values(metadata).some((value) => typeof value !== 'string')) {
      reject('bad-metadata', '`metadata` must map text to text')
    }
  }
  if (data.compatibility !== undefined && (typeof data.compatibility !== 'string' || data.compatibility.length > 500)) {
    reject('bad-compatibility', '`compatibility` must be text of at most 500 characters')
  }
  if (data.license !== undefined && typeof data.license !== 'string') reject('bad-license', '`license` must be text')

  for (const key of Object.keys(data)) {
    const grants = AUTHORIZING.get(key)
    if (grants !== undefined) reject('authorizing-field', `\`${key}\` ${grants}`, 'SKILL.md')
    else if (!SPEC_FIELDS.has(key)) flag('unknown-field', `\`${key}\` is not an Agent Skills field; some harnesses ignore it`, 'SKILL.md')
  }

  return {
    name,
    description,
    license: typeof data.license === 'string' ? data.license : null,
    findings,
    ok: !findings.some((finding) => finding.level === 'reject'),
  }
}
