import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { looksExecutable } from '@althar/skills'
import { MAX_WORKER_SKILL_BYTES, MAX_WORKER_SKILL_FILES, type WorkerSkillFile } from '@althar/worker-protocol/agent-runs'

/** Read only the private projection built for this session. The worker receives no provider or home settings. */
export const workerSkillFiles = async (folder: string): Promise<ReadonlyArray<WorkerSkillFile>> => {
  const files: WorkerSkillFile[] = []
  let bytes = 0
  const read = async (current: string, relative: string) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (
        Buffer.byteLength(path) > 512 ||
        /\p{Cc}/u.test(path) ||
        path.split('/').some((part) => part === '.git' || part === '..' || part === '.' || part.includes('\\'))
      )
        throw new Error('The selected worker skill has an invalid path.')
      if (entry.isDirectory()) {
        await read(join(current, entry.name), path)
        continue
      }
      if (!entry.isFile() || files.length >= MAX_WORKER_SKILL_FILES)
        throw new Error('The selected worker skills are too large or contain links.')
      const source = await open(join(current, entry.name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const stat = await source.stat()
        if (!stat.isFile() || stat.size > MAX_WORKER_SKILL_BYTES - bytes) throw new Error('The selected worker skills are too large.')
        const data = Buffer.alloc(stat.size + 1)
        let readBytes = 0
        while (readBytes < data.length) {
          const { bytesRead } = await source.read(data, readBytes, data.length - readBytes, readBytes)
          if (bytesRead === 0) break
          readBytes += bytesRead
        }
        if (readBytes !== stat.size) throw new Error('A selected worker skill changed during setup.')
        bytes += readBytes
        files.push({ path, data: data.subarray(0, readBytes), executable: looksExecutable(path) })
      } finally {
        await source.close()
      }
    }
  }
  await read(folder, '')
  return files
}
