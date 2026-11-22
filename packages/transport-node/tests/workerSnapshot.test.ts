import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerSnapshot, WorkerSnapshotChunkRequest } from '@althar/contracts'
import { expect, it } from 'vitest'
import { installWorkerSnapshot, workerCopyFolder } from '../src/workerSnapshot'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })
    .toString()
    .trim()

it('trims only trailing dots and prefixes names reserved by Windows', () => {
  expect(workerCopyFolder('con...')).toBe('repo-con')
  expect(workerCopyFolder('my.project...')).toBe('repo-my.project')
  const internalDots = 'start' + '.'.repeat(32_768) + 'end'
  expect(workerCopyFolder(internalDots)).toBe('repo-' + internalDots)
})

it('installs the exact committed, staged and working files without replacing a local folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'althar-local-snapshot-test-'))
  try {
    const source = join(root, 'source')
    const destination = join(root, 'destination')
    await mkdir(source)
    await mkdir(destination)
    await writeFile(join(destination, 'existing'), 'Keep me')
    git(source, 'init', '-qb', 'main')
    await writeFile(join(source, 'README.md'), 'Committed\n')
    git(source, 'add', 'README.md')
    git(source, 'commit', '-qm', 'Committed state')
    const head = git(source, 'rev-parse', 'HEAD')
    await writeFile(join(source, 'README.md'), 'Staged edit\n')
    git(source, 'add', 'README.md')
    const index = git(source, 'write-tree')
    await writeFile(join(source, 'README.md'), 'Unstaged edit\n')
    await writeFile(join(source, 'scratch.txt'), 'Untracked work\n')
    git(source, 'add', '-A')
    const tree = git(source, 'write-tree')
    for (const [name, state] of [
      ['worker-index', index],
      ['worker-snapshot', tree],
    ] as const) {
      const commit = git(source, 'commit-tree', state, '-p', head, '-m', name)
      git(source, 'update-ref', 'refs/althar/' + name, commit)
    }
    const archive = join(root, 'snapshot.bundle')
    git(source, 'bundle', 'create', archive, 'refs/althar/worker-index', 'refs/althar/worker-snapshot')
    const bytes = await readFile(archive)
    const workspaceId = 'ws_' + '1'.repeat(32)
    const snapshot: WorkerSnapshot = {
      id: 'snap_' + '2'.repeat(32),
      projectId: 'proj_' + '3'.repeat(32),
      taskId: 'task_' + '4'.repeat(32),
      source: 'worker',
      repositories: [
        { name: 'project', workspaceId, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), head, tree, index },
      ],
    }
    const offsets: number[] = []
    const read = async ({ id, workspaceId: asked, offset }: WorkerSnapshotChunkRequest) => {
      expect(id).toBe(snapshot.id)
      expect(asked).toBe(workspaceId)
      offsets.push(offset)
      const piece = bytes.subarray(offset, offset + 53)
      const nextOffset = offset + piece.length
      return { bodyBase64: piece.toString('base64'), nextOffset, done: nextOffset === bytes.length }
    }
    const signal = AbortSignal.timeout(10_000)
    const wrong: WorkerSnapshot = { ...snapshot, repositories: [{ ...snapshot.repositories[0]!, sha256: '0'.repeat(64) }] }
    await expect(installWorkerSnapshot(wrong, destination, read, signal)).rejects.toThrow('checksum')
    expect(await readdir(destination)).toEqual(['existing'])
    offsets.length = 0
    const local = await installWorkerSnapshot(snapshot, destination, read, signal)
    const repo = join(local, 'repo-project')
    expect(await readFile(join(destination, 'existing'), 'utf8')).toBe('Keep me')
    expect(offsets.length).toBeGreaterThan(1)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(repo, 'write-tree')).toBe(index)
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('Unstaged edit\n')
    expect(await readFile(join(repo, 'scratch.txt'), 'utf8')).toBe('Untracked work\n')
    expect(git(repo, 'status', '--porcelain')).toContain('?? scratch.txt')
    expect(JSON.parse(await readFile(join(local, 'althar-snapshot.json'), 'utf8'))).toEqual(snapshot)
    if (process.platform !== 'win32') {
      await symlink(join(destination, 'existing'), join(source, 'outside'))
      git(source, 'add', 'outside')
      const linked = git(source, 'write-tree')
      const commit = git(source, 'commit-tree', linked, '-p', head, '-m', 'A link outside the copy')
      git(source, 'update-ref', 'refs/althar/worker-snapshot', commit)
      const invalidArchive = join(root, 'links.bundle')
      git(source, 'bundle', 'create', invalidArchive, 'refs/althar/worker-index', 'refs/althar/worker-snapshot')
      const bad = await readFile(invalidArchive)
      const exported = snapshot.repositories[0]!
      const withLink = {
        ...snapshot,
        repositories: [
          {
            ...exported,
            tree: linked,
            bytes: bad.length,
            sha256: createHash('sha256').update(bad).digest('hex'),
          },
        ],
      }
      const before = await readdir(destination)
      await expect(
        installWorkerSnapshot(
          withLink,
          destination,
          async ({ offset }) => ({
            bodyBase64: bad.subarray(offset).toString('base64'),
            nextOffset: bad.length,
            done: true,
          }),
          signal,
        ),
      ).rejects.toThrow('link outside')
      expect(await readdir(destination)).toEqual(before)
      expect(await readFile(join(destination, 'existing'), 'utf8')).toBe('Keep me')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
