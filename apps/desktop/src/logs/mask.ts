/*
 * What a report hides before anything leaves the Mac (DEV-61): paths under
 * the home folder, the names of the person's projects and repositories, who
 * they are on this computer, email addresses, and anything that looks like a
 * key or a token. Althar's logs never hold a token, but an agent's stderr or
 * a library's error might, so the text is scanned for them anyway. A path
 * keeps its last part, which is usually what tells what went wrong (a file,
 * a database), and loses the folders on the way, which say whose it is.
 */

/** What stands in for each thing hidden. */
export const HIDDEN = { secret: '[secret]', email: '[email]', user: '[user]', device: '[device]' } as const

/** Names too common to say whose work it is, kept so the logs stay readable: a repository called `api`, or a folder of them called `Code`, gives nothing away. */
const COMMON = new Set([
  'althar',
  'api',
  'app',
  'apps',
  'backend',
  'cli',
  'client',
  'code',
  'core',
  'desktop',
  'dev',
  'developer',
  'docs',
  'documents',
  'frontend',
  'git',
  'github',
  'lib',
  'main',
  'master',
  'packages',
  'projects',
  'repos',
  'runtime',
  'server',
  'site',
  'sites',
  'src',
  'test',
  'tests',
  'ui',
  'web',
  'work',
  'workspace',
])

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/*
 * Keys and tokens, by the shapes their issuers give them, and by where they
 * sit: an Authorization header, a key=value or "key": "value" whose key says
 * secret, credentials in a URL, a token in a query string. Each keeps what
 * says what it was, and loses the value.
 */
const SECRETS: ReadonlyArray<readonly [RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, HIDDEN.secret],
  [/\bsk-ant-[\w-]{10,}/g, HIDDEN.secret],
  [/\bsk-(?:proj-|svcacct-)?[\w-]{20,}/g, HIDDEN.secret],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/g, HIDDEN.secret],
  [/\bglpat-[\w-]{20,}/g, HIDDEN.secret],
  [/\bxox[abposr]-[\w-]{10,}/g, HIDDEN.secret],
  [/\blin_(?:api|oauth)_\w{20,}/g, HIDDEN.secret],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, HIDDEN.secret],
  [/\bAIza[\w-]{35}/g, HIDDEN.secret],
  [/\bATATT[\w=-]{20,}/g, HIDDEN.secret],
  [/\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g, HIDDEN.secret],
  [/\b(Bearer|Basic|token)(\s+)[\w.~+/=-]{16,}/gi, `$1$2${HIDDEN.secret}`],
  [/\b(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${HIDDEN.secret}@`],
  [
    /([?&](?:access_token|refresh_token|id_token|token|key|api_key|apikey|code|client_secret|sig|signature|password)=)[^&\s"']+/gi,
    `$1${HIDDEN.secret}`,
  ],
  [
    /("[\w-]*(?:api[_-]?key|token|secret|password|passwd|credential|private[_-]?key|access[_-]?key|authorization)[\w-]*"\s*:\s*")[^"]{6,}(")/gi,
    `$1${HIDDEN.secret}$2`,
  ],
  [
    /\b([\w-]*(?:api[_-]?key|token|secret|password|passwd|credential|private[_-]?key|access[_-]?key|authorization)[\w-]*\s*[:=]\s*)(["']?)(?!\[secret\])(?=[^\s"',;]*[A-Za-z])[^\s"',;]{6,}\2/gi,
    `$1$2${HIDDEN.secret}$2`,
  ],
]

/** The text with every key and token in it hidden, and how many there were. */
export const scrubSecrets = (text: string): { readonly text: string; readonly found: number } => {
  let found = 0
  let scrubbed = text
  for (const [pattern, replacement] of SECRETS) {
    scrubbed = scrubbed.replace(pattern, (...match: Array<unknown>) => {
      found += 1
      // The replacement's $n refer to the match's groups, as String.replace would read them.
      return replacement.replace(/\$(\d)/g, (_, n: string) => {
        const group = match[Number(n)]
        return typeof group === 'string' ? group : ''
      })
    })
  }
  return { text: scrubbed, found }
}

export interface MaskOptions {
  /** The person's home folder. */
  readonly home: string
  /** Their name on this computer. */
  readonly user?: string
  /** What this computer is called. */
  readonly device?: string
  /** Names to hide wherever they stand alone, by what they are: `{ project: [...], repository: [...] }`. */
  readonly names?: Readonly<Record<string, ReadonlyArray<string>>>
}

/** What stands in for a path under the home folder: `~`, then its last part, with the folders between as `…`. */
const shortPath = (rest: string): string => {
  const parts = rest.split(/[\\/]/).filter((part) => part !== '')
  if (parts.length === 0) return '~'
  if (parts.length === 1) return `~/${parts[0]}`
  return `~/…/${parts.at(-1)}`
}

/**
 * Hides, in this order: keys and tokens; email addresses; paths under the
 * home folder; project and repository names, each as `[project-1]`,
 * `[repository-2]`, the same name always the same stand-in; and the
 * person's name and the computer's.
 */
export const masker = ({ home, user, device, names = {} }: MaskOptions) => {
  const homes = [home.replace(/[\\/]+$/, '')].filter((each) => each.length > 1)
  // Where a path under the home folder ends: a space, a quote, or the punctuation round it.
  const paths =
    homes.length === 0
      ? undefined
      : new RegExp(`(?:${homes.map(escape).join('|')})(?![\\w.-])((?:[\\\\/][^\\s"'\`<>|;,()\\[\\]{}]*)?)`, 'g')

  // Longest first, so a name inside another doesn't break the longer one.
  const stand: Array<readonly [string, string]> = []
  for (const [kind, list] of Object.entries(names)) {
    const seen = new Set<string>()
    for (const name of list) {
      const key = name.trim().toLowerCase()
      if (key.length < 3 || COMMON.has(key) || seen.has(key)) continue
      seen.add(key)
      stand.push([name.trim(), `[${kind}-${seen.size}]`])
    }
  }
  stand.sort(([a], [b]) => b.length - a.length)
  const named = stand.map(([name, instead]) => [new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, 'gi'), instead] as const)

  const words = [
    ...(user !== undefined && user.length >= 3 ? [[user, HIDDEN.user] as const] : []),
    ...(device !== undefined && device.length >= 3
      ? [
          [device, HIDDEN.device] as const,
          // Its name before any .local, as a Mac also goes by.
          ...(device.includes('.') ? [[device.split('.')[0] ?? device, HIDDEN.device] as const] : []),
        ]
      : []),
  ].map(([word, instead]) => [new RegExp(`(?<![A-Za-z0-9])${escape(word)}(?![A-Za-z0-9])`, 'gi'), instead] as const)

  return (text: string): string => {
    let masked = scrubSecrets(text).text.replace(/[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, HIDDEN.email)
    if (paths !== undefined) masked = masked.replace(paths, (_, rest: string) => shortPath(rest))
    for (const [pattern, instead] of named) masked = masked.replace(pattern, instead)
    for (const [pattern, instead] of words) masked = masked.replace(pattern, instead)
    return masked
  }
}
