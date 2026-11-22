import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { MAX_SNAPSHOT_CHUNK, WorkerSnapshot, type WorkerSnapshotChunk, type WorkerSnapshotChunkRequest } from '@althar/contracts'
import { Schema } from 'effect'

const exec = promisify(execFile)
const SNAPSHOT_REF = 'refs/althar/worker-snapshot'
const INDEX_REF = 'refs/althar/worker-index'
const MAX_SET_BYTES = 256 * 1024 * 1024

const beneath = (folder: string, file: string) => {
  const path = relative(folder, file)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep))
}

const checkLinks = async (root: string, directory: string, signal: AbortSignal) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    signal.throwIfAborted()
    if (entry.name === '.git' && directory === root) continue
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const destination = await realpath(path).catch(() => null)
      if (destination === null || !beneath(root, destination) || beneath(join(root, '.git'), destination))
        throw new Error('The workspace copy contains a link outside its project files.')
    } else if (entry.isDirectory()) await checkLinks(root, path, signal)
    else if (!entry.isFile()) throw new Error('The workspace copy contains an unsupported file.')
  }
}

/** A private local Git worktree from a verified export. Failed downloads never publish a partial workspace. */
export const installWorkerSnapshot = async (
  payload: WorkerSnapshot,
  destination: string,
  read: (request: WorkerSnapshotChunkRequest, signal: AbortSignal) => Promise<WorkerSnapshotChunk>,
  signal: AbortSignal,
) => {
  const snapshot = Schema.decodeUnknownSync(WorkerSnapshot)(payload)
  const names = new Set(snapshot.repositories.map((entry) => entry.name))
  const workspaces = new Set(snapshot.repositories.map((entry) => entry.workspaceId))
  if (
    names.size !== snapshot.repositories.length ||
    workspaces.size !== snapshot.repositories.length ||
    snapshot.repositories.reduce((sum, entry) => sum + entry.bytes, 0) > MAX_SET_BYTES
  )
    throw new Error('The home supplied an invalid workspace snapshot.')
  signal.throwIfAborted()
  const parent = await realpath(destination)
  if (!(await lstat(parent)).isDirectory()) throw new Error('Choose a folder for the workspace copy.')
  const transfer = await mkdtemp(join(parent, 'althar-copy-'))
  const staging = join(transfer, '.preparing')
  const installed = join(transfer, 'workspace')
  const config = join(transfer, '.empty-gitconfig')
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: config,
    GIT_TERMINAL_PROMPT: '0',
  }
  const git = async (cwd: string, ...args: string[]) => {
    const { stdout } = await exec('git', ['-c', 'core.hooksPath=' + join(transfer, '.disabled-hooks'), ...args], { cwd, env, signal })
    return stdout.trim()
  }
  try {
    await mkdir(staging, { mode: 0o700 })
    await writeFile(config, '', { mode: 0o600, flag: 'wx' })
    for (const repo of snapshot.repositories) {
      signal.throwIfAborted()
      const archive = join(transfer, repo.workspaceId + '.bundle')
      const file = await open(archive, 'wx', 0o600)
      const digest = createHash('sha256')
      try {
        let offset = 0
        while (offset < repo.bytes) {
          signal.throwIfAborted()
          const chunk = await read({ id: snapshot.id, workspaceId: repo.workspaceId, offset }, signal)
          const bytes = Buffer.from(chunk.bodyBase64, 'base64')
          const next = offset + bytes.length
          if (
            bytes.length === 0 ||
            bytes.length > MAX_SNAPSHOT_CHUNK ||
            next > repo.bytes ||
            bytes.toString('base64') !== chunk.bodyBase64 ||
            chunk.nextOffset !== next ||
            chunk.done !== (next === repo.bytes)
          )
            throw new Error('The home returned an incomplete workspace chunk.')
          await file.writeFile(bytes)
          digest.update(bytes)
          offset = next
        }
        if (digest.digest('hex') !== repo.sha256) throw new Error('The workspace download did not match its checksum.')
        await file.sync()
      } finally {
        await file.close()
      }
      // The prefix makes a Git repository's display name safe as a Windows directory too.
      const folder = join(staging, 'repo-' + repo.name.replace(/\.+$/, ''))
      await mkdir(folder, { mode: 0o700 })
      await git(folder, 'init', '--quiet', '--template=', repo.head.length === 64 ? '--object-format=sha256' : '--object-format=sha1')
      await git(
        folder,
        '-c',
        'protocol.file.allow=always',
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-recurse-submodules',
        archive,
        SNAPSHOT_REF + ':refs/althar/import-files',
        INDEX_REF + ':refs/althar/import-index',
      )
      const [tree, base, index, stagedBase] = await Promise.all([
        git(folder, 'rev-parse', 'refs/althar/import-files^{tree}'),
        git(folder, 'rev-parse', 'refs/althar/import-files^'),
        git(folder, 'rev-parse', 'refs/althar/import-index^{tree}'),
        git(folder, 'rev-parse', 'refs/althar/import-index^'),
      ])
      if (tree !== repo.tree || base !== repo.head || index !== repo.index || stagedBase !== repo.head)
        throw new Error('The Git bundle did not contain the verified workspace state.')
      await git(folder, 'checkout', '--quiet', '--detach', 'refs/althar/import-files')
      await checkLinks(folder, folder, signal)
      await git(folder, 'update-ref', '--no-deref', 'HEAD', repo.head)
      await git(folder, 'read-tree', repo.index)
      await rm(archive)
    }
    // Name exactly which workspace versions are available even when the original worker goes away.
    await writeFile(join(staging, 'althar-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 })
    await rm(config)
    signal.throwIfAborted()
    await rename(staging, installed)
    return installed
  } catch (error) {
    await rm(transfer, { recursive: true, force: true })
    throw error
  }
}
