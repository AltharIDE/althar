import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/*
 * Notarizing (ADR-024): sending the signed app, and then its dmg, to Apple's
 * notary service with notarytool, waiting for its verdict, and stapling the
 * ticket to what was sent, so Gatekeeper accepts it offline. The service's
 * log is kept for every submission, beside the packages: a rejected one
 * names each binary it found wrong.
 *
 * The credentials come from the environment and are never kept here: an App
 * Store Connect API key (APPLE_API_KEY, the path to its .p8, with
 * APPLE_API_KEY_ID and APPLE_API_ISSUER), or a profile notarytool keeps in
 * the keychain (APPLE_KEYCHAIN_PROFILE, made once with `xcrun notarytool
 * store-credentials`, with APPLE_KEYCHAIN for a keychain other than the
 * login one). With neither, nothing is notarized.
 */

export type NotaryAuth =
  | { readonly kind: 'key'; readonly key: string; readonly keyId: string; readonly issuer: string }
  | { readonly kind: 'profile'; readonly profile: string; readonly keychain?: string }

const given = (value: string | undefined) => (value === undefined || value.trim() === '' ? undefined : value.trim())

/** The notary service's credentials in the environment; null where there are none. Part of an API key, without the rest, is a mistake, and fails. */
export const notaryAuth = (env: Readonly<Record<string, string | undefined>>): NotaryAuth | null => {
  const key = given(env.APPLE_API_KEY)
  const keyId = given(env.APPLE_API_KEY_ID)
  const issuer = given(env.APPLE_API_ISSUER)
  if (key !== undefined || keyId !== undefined || issuer !== undefined) {
    const missing = Object.entries({ APPLE_API_KEY: key, APPLE_API_KEY_ID: keyId, APPLE_API_ISSUER: issuer })
      .filter(([, value]) => value === undefined)
      .map(([name]) => name)
    if (key === undefined || keyId === undefined || issuer === undefined)
      throw new Error(
        `Notarizing with an API key needs APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER; ${missing.join(' and ')} not set.`,
      )
    return { kind: 'key', key, keyId, issuer }
  }
  const profile = given(env.APPLE_KEYCHAIN_PROFILE)
  if (profile === undefined) return null
  const keychain = given(env.APPLE_KEYCHAIN)
  return keychain === undefined ? { kind: 'profile', profile } : { kind: 'profile', profile, keychain }
}

/** notarytool's own arguments for the credentials. */
export const notaryArgs = (auth: NotaryAuth): ReadonlyArray<string> =>
  auth.kind === 'key'
    ? ['--key', auth.key, '--key-id', auth.keyId, '--issuer', auth.issuer]
    : ['--keychain-profile', auth.profile, ...(auth.keychain === undefined ? [] : ['--keychain', auth.keychain])]

/** What to say when nothing is notarized. */
export const NOT_NOTARIZING =
  'Not notarizing: set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, or APPLE_KEYCHAIN_PROFILE. Without it, macOS refuses the app on any Mac but this one.'

interface Submission {
  readonly id?: string
  readonly status?: string
  readonly message?: string
}

/**
 * Notarizes an app or a dmg and staples its ticket. An app goes as a zip of
 * itself, as the service takes no folders. Fails, with where its log is,
 * unless the service accepts it.
 */
export const notarize = (path: string, auth: NotaryAuth, logs: string) => {
  mkdirSync(logs, { recursive: true })
  const name = basename(path)
  const app = path.endsWith('.app')
  const upload = app ? join(dirname(path), `${name}.notarize.zip`) : path
  if (app) execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path, upload], { stdio: 'inherit' })
  try {
    process.stdout.write(`Sending ${name} to Apple's notary service, and waiting for it…\n`)
    const sent = spawnSync('xcrun', ['notarytool', 'submit', upload, '--wait', '--output-format', 'json', ...notaryArgs(auth)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let submission: Submission = {}
    try {
      submission = JSON.parse(sent.stdout) as Submission
    } catch {
      throw new Error(`notarytool said nothing it could be read by for ${name}:\n${sent.stdout}`)
    }
    if (submission.id === undefined)
      throw new Error(`The notary service took no submission for ${name}: ${submission.message ?? sent.stdout}`)
    const log = join(logs, `${name}-${submission.id}.json`)
    const fetched = spawnSync('xcrun', ['notarytool', 'log', submission.id, ...notaryArgs(auth), log], { encoding: 'utf8' })
    if (fetched.status !== 0) writeFileSync(log, `${JSON.stringify(submission, null, 2)}\n`)
    if (submission.status !== 'Accepted')
      throw new Error(`The notary service said ${submission.status ?? 'nothing'} for ${name}. Its log, naming what it found, is ${log}`)
    process.stdout.write(`Notarized ${name} (${submission.id}); the log is ${log}\n`)
  } finally {
    if (app) rmSync(upload, { force: true })
  }
  execFileSync('xcrun', ['stapler', 'staple', path], { stdio: 'inherit' })
}
