import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { copyFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

// No production signing secret is needed or accepted by this smoke test.
const root = mkdtempSync(join(tmpdir(), 'althar-release-smoke-'))
try {
  const pair = generateKeyPairSync('ed25519')
  const output = join(root, 'output')
  const fixture = process.env.ALTHAR_HOST_BOOTSTRAP_FIXTURE || undefined
  const base = fixture === undefined ? 'https://example.invalid/host/' : 'https://127.0.0.1:8443/'
  const env = {
    HOME: root,
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    ALTHAR_HOST_RELEASE_SIGNING_KEY: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
  const result: unknown = JSON.parse(
    execFileSync(
      process.execPath,
      [
        resolve('dist/althar-host.js'),
        'package-release',
        '--release-base-url',
        base,
        '--release-sequence',
        '1',
        '--output',
        output,
        '--json',
      ],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    ),
  )
  if (
    typeof result !== 'object' ||
    result === null ||
    !('manifest' in result) ||
    typeof result.manifest !== 'string' ||
    !('archive' in result) ||
    typeof result.archive !== 'string'
  )
    throw new Error('Missing packaged release')
  const signed: unknown = JSON.parse(readFileSync(result.manifest, 'utf8'))
  if (
    typeof signed !== 'object' ||
    signed === null ||
    !('payload' in signed) ||
    typeof signed.payload !== 'string' ||
    !('signature' in signed) ||
    typeof signed.signature !== 'string'
  )
    throw new Error('Malformed release envelope')
  const payload = Buffer.from(signed.payload, 'base64url')
  if (!verify(null, payload, pair.publicKey, Buffer.from(signed.signature, 'base64url'))) throw new Error('Invalid release signature')
  const manifest: unknown = JSON.parse(payload.toString('utf8'))
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('unpackedBytes' in manifest) ||
    typeof manifest.unpackedBytes !== 'number' ||
    !('archive' in manifest) ||
    typeof manifest.archive !== 'object' ||
    manifest.archive === null ||
    !('sha256' in manifest.archive) ||
    !('bytes' in manifest.archive)
  )
    throw new Error('Malformed release manifest')
  const bytes = readFileSync(result.archive)
  if (bytes.length !== manifest.archive.bytes || createHash('sha256').update(bytes).digest('hex') !== manifest.archive.sha256)
    throw new Error('Invalid release archive')
  const unpacked = join(root, 'unpacked')
  mkdirSync(unpacked, { mode: 0o700 })
  execFileSync('/usr/bin/tar', ['-xzf', result.archive, '-C', unpacked])
  if (
    !readFileSync(join(unpacked, 'LICENSE'), 'utf8').includes('Apache License') ||
    !readFileSync(join(unpacked, 'THIRD_PARTY_NOTICES.txt'), 'utf8').includes('effect@')
  )
    throw new Error('Missing application or bundled dependency license notices')
  // This cwd has no workspace node_modules. Both native provider CLIs and the
  // exact patched adapter packages must resolve from the portable release.
  const { ALTHAR_HOST_RELEASE_SIGNING_KEY: _, ...probeEnvironment } = env
  execFileSync(join(unpacked, 'node/bin/node'), [join(unpacked, 'dist/althar-host.js'), 'verify-release', '--json'], {
    cwd: root,
    env: probeEnvironment,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (fixture !== undefined) {
    mkdirSync(fixture, { mode: 0o700 })
    const archive = basename(result.archive)
    copyFileSync(result.archive, join(fixture, archive))
    const envelope = readFileSync(result.manifest)
    const key = pair.publicKey.export({ type: 'spki', format: 'pem' })
    writeFileSync(
      join(fixture, 'install-args'),
      [
        manifest.archive.sha256,
        bytes.length,
        manifest.unpackedBytes,
        new URL(archive, base).href,
        envelope.toString('base64'),
        Buffer.from(key).toString('base64'),
        archive,
      ].join('\n') + '\n',
      { mode: 0o600 },
    )
  }
  const preview = process.env.ALTHAR_HOST_PREVIEW_DIRECTORY
  if (preview) cpSync(unpacked, preview, { recursive: true, force: false, errorOnExist: true })
  process.stdout.write('Signed portable host release verified outside the workspace.\n')
} finally {
  rmSync(root, { recursive: true, force: true })
}
