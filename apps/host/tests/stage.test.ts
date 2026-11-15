import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { c } from 'tar'
import { describe, expect, it } from 'vitest'

import { stageUpdate, checkCandidate, findManifest } from '../src/updates/stage'
import { authenticateRelease, digest } from '../src/updates/release'
import { loadInstallation, readState, saveState } from '../src/updates/store'
import { fixtureFiles, updateFixture } from './updateFixture'
import { temporary } from './support'

const downloadable = async () => {
  const at = await updateFixture()
  const source = join(temporary(), 'release')
  fixtureFiles(source)
  const archive = join(temporary(), 'release.tar.gz')
  await c({ file: archive, cwd: source, gzip: true, portable: true, noMtime: true }, ['dist', 'node', 'package.json'])
  const bytes = readFileSync(archive)
  const sizes = ['dist/althar-host.js', 'node/bin/node', 'node/LICENSE', 'package.json'].map(
    (path) => readFileSync(join(source, path)).length,
  )
  const manifest = {
    ...at.manifest,
    files: 4,
    unpackedBytes: sizes.reduce((sum, value) => sum + value, 0),
    archive: { ...at.manifest.archive, bytes: bytes.length, sha256: digest(bytes) },
  }
  const envelope = at.seal(manifest)
  const release = authenticateRelease(envelope, at.config.keys, at.oldInfo.arch)
  await saveState(at.root, { format: 1, current: at.oldId, active: at.oldId, sequence: 0 })
  const fetch = async (url: string) => new Response(url.endsWith('/feed') ? envelope : bytes)
  return { ...at, bytes, release, fetch }
}

describe('release staging without service interruption', () => {
  it('downloads, extracts, probes and publishes a release while keeping the running code selected', async () => {
    const at = await downloadable()
    expect(await stageUpdate(at.root, { ...at.dependencies, fetch: at.fetch })).toEqual({ state: 'staged', version: '0.1.1' })
    const state = await readState(at.root)
    expect(state.current).toBe(at.oldId)
    expect(state.active).toBe(at.oldId)
    expect(state.staged).toBe(at.release.id)
    expect(at.calls).toEqual([])
    expect((await stageUpdate(at.root, { ...at.dependencies, fetch: at.fetch })).state).toBe('staged')
    await saveState(at.root, { ...state, current: at.release.id, active: at.release.id })
    expect((await stageUpdate(at.root, { ...at.dependencies, fetch: at.fetch })).state).toBe('current')
  })

  it('does not publish a wrong executable, corrupted archive or downgraded/forked feed', async () => {
    const at = await downloadable()
    await expect(
      stageUpdate(at.root, {
        ...at.dependencies,
        fetch: at.fetch,
        execute: async () => JSON.stringify({ ...at.nextInfo, apiVersion: 99 }),
      }),
    ).rejects.toMatchObject({ code: 'ReleaseRejected' })
    expect((await readState(at.root)).staged).toBeUndefined()
    await expect(
      stageUpdate(at.root, {
        ...at.dependencies,
        fetch: async (url) => new Response(url.endsWith('/feed') ? at.release.envelope : Buffer.alloc(at.bytes.length)),
      }),
    ).rejects.toThrow()
    expect((await readState(at.root)).current).toBe(at.oldId)
    await stageUpdate(at.root, { ...at.dependencies, fetch: at.fetch })
    const fork = at.seal({ ...at.release.manifest, archive: { ...at.release.manifest.archive, url: 'https://updates.example/other' } })
    await expect(stageUpdate(at.root, { ...at.dependencies, fetch: async () => new Response(fork) })).rejects.toThrow()
    await expect(checkCandidate(join(at.root, 'missing'), at.nextInfo, at.dependencies.execute)).rejects.toThrow()
  })

  it('recovers an unreferenced directory left between archive publication and journalling', async () => {
    const at = await downloadable()
    fixtureFiles(join(at.root, 'releases', at.release.id), 'orphan')
    expect((await stageUpdate(at.root, { ...at.dependencies, fetch: at.fetch })).state).toBe('staged')
    expect(readFileSync(join(at.root, 'releases', at.release.id, 'dist/althar-host.js'), 'utf8')).toBe('fixture')
  })

  it('discovers only published stable host releases, without treating desktop releases as host updates', async () => {
    const at = await updateFixture()
    const installation = await loadInstallation(at.root)
    const github = { ...installation, config: { ...at.config, feed: { kind: 'github' as const, repository: 'AltharIDE/althar' } } }
    const asset = { name: `althar-host-linux-${at.oldInfo.arch}.json`, browser_download_url: 'https://updates.example/feed' }
    const fetch = async (url: string) =>
      new Response(
        url.includes('api.github.com')
          ? JSON.stringify([
              { tag_name: 'v9.0.0', draft: false, prerelease: false, assets: [asset] },
              { tag_name: 'host-v1.0.0', draft: true, prerelease: false, assets: [asset] },
              { tag_name: 'host-v0.1.1', draft: false, prerelease: false, assets: [asset] },
            ])
          : at.envelope,
      )
    expect(await findManifest(github, fetch)).toEqual(at.envelope)
    await expect(findManifest(github, async () => new Response('[]'))).rejects.toThrow()
  })
})
