import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * The Node the packaged app runs the agent adapters on (ADR-030): Althar's
 * own binary doesn't run as Node there, as its `runAsNode` fuse is off. It
 * is Node's official build, at the version Electron's own Node is, so the
 * adapters run on the Node dev and CI run them on (Electron's, as Node). It
 * is fetched from nodejs.org once, checked against the digests below, which
 * come from that release's SHASUMS256.txt, and kept for the next package.
 * Raise it with Electron, and for Node's security releases: the version, and
 * the digest of each platform's archive.
 */

export const NODE_VERSION = '24.21.0'

/** Each platform's archive, by Node's `platform-arch`, and its SHA-256 from the release's SHASUMS256.txt. */
export const NODE_ARCHIVES: Readonly<Record<string, string>> = {
  'darwin-arm64': 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
  'darwin-x64': '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
  'linux-arm64': '724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5',
  'linux-x64': '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff',
}

/** Where the app keeps its Node, under its resources: `bin/node`, with Node's license beside it. */
export const NODE_IN_APP = 'node'

/** The archive's name and where nodejs.org has it. */
export const nodeArchive = (platform: string, arch: string) => {
  const name = `node-v${NODE_VERSION}-${platform}-${arch}`
  return { name, url: `https://nodejs.org/dist/v${NODE_VERSION}/${name}.tar.gz` }
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/**
 * A folder holding `bin/node` and `LICENSE` for this platform, kept in
 * `cache`: fetched where it isn't there yet, and refused where its archive's
 * digest isn't the one pinned here.
 */
export const fetchNode = async (cache: string, platform: string = process.platform, arch: string = process.arch): Promise<string> => {
  const digest = NODE_ARCHIVES[`${platform}-${arch}`]
  if (digest === undefined) throw new Error(`Althar ships no Node for ${platform}-${arch}.`)
  const { name, url } = nodeArchive(platform, arch)
  const kept = join(cache, name)
  // The archive's digest is written last, so a folder with it is whole.
  if (existsSync(join(kept, 'sha256')) && readFileSync(join(kept, 'sha256'), 'utf8') === digest) return kept
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Node ${NODE_VERSION} couldn't be fetched from ${url}: ${response.status}`)
  const archive = new Uint8Array(await response.arrayBuffer())
  const got = sha256(archive)
  if (got !== digest) throw new Error(`${url} has SHA-256 ${got}, not the ${digest} pinned in scripts/node.ts.`)
  const scratch = mkdtempSync(join(cache, '.fetching-'))
  try {
    writeFileSync(join(scratch, 'node.tar.gz'), archive)
    execFileSync('tar', ['-xzf', 'node.tar.gz', `${name}/bin/node`, `${name}/LICENSE`], { cwd: scratch })
    rmSync(kept, { recursive: true, force: true })
    mkdirSync(kept, { recursive: true })
    cpSync(join(scratch, name, 'bin'), join(kept, 'bin'), { recursive: true })
    cpSync(join(scratch, name, 'LICENSE'), join(kept, 'LICENSE'))
    writeFileSync(join(kept, 'sha256'), digest)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return kept
}
