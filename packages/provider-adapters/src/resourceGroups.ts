import { constants } from 'node:fs'
import { access, mkdir, readFile, rmdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path/posix'
import { Effect } from 'effect'

/** A worker's Linux scheduling group. All native commands of the same worker share it. */
export interface ResourceGroup {
  readonly path: string
  readonly release: () => Promise<void>
}

export interface ResourceGroups {
  acquire(owner: string): Promise<ResourceGroup | undefined>
}

export interface GroupFiles {
  read(path: string): Promise<string>
  write(path: string, value: string): Promise<void>
  writable(path: string): Promise<void>
  make(path: string): Promise<void>
  remove(path: string): Promise<void>
}

/**
 * Work-conserving CPU weights, not quotas: siblings share equally while an idle sibling leaves its CPU available.
 * A private parent gives Althar's background work less weight than the person's other applications. Delegation is
 * optional. A desktop without it keeps its normal background priority and pressure-aware admission.
 */
export const linuxGroups = (
  options: { readonly mount?: string; readonly membership?: string; readonly parent?: string; readonly files?: GroupFiles } = {},
): ResourceGroups => {
  const files: GroupFiles = options.files ?? {
    read: (path) => readFile(path, 'utf8'),
    write: (path, value) => writeFile(path, value),
    writable: (path) => access(path, constants.W_OK),
    make: (path) => mkdir(path).then(() => {}),
    remove: rmdir,
  }
  const mount = options.mount ?? '/sys/fs/cgroup'
  const membership = options.membership ?? '/proc/self/cgroup'
  interface Worker {
    path: string
    refs: number
  }
  interface Generation {
    ready: Promise<string | undefined>
    users: number
    workers: Map<string, Promise<Worker | undefined>>
    retiring: Map<string, Promise<void>>
  }
  let current: Generation | undefined
  let unavailable = false
  const remove = async (path: string) => {
    // cgroup.kill returns before the kernel has reaped every child. Never recursively unlink virtual control files.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await files.remove(path)
        return
      } catch {
        if (attempt < 7) await Effect.runPromise(Effect.sleep('25 millis'))
      }
    }
  }
  const prepare = async () => {
    try {
      let parent = options.parent
      if (parent === undefined) {
        const current = /^0::(.*)$/m.exec(await files.read(membership))?.[1]
        if (current === undefined) return undefined
        const own = resolve(mount, `.${current}`)
        const under = relative(resolve(mount), own)
        if (under === '..' || under.startsWith('../')) return undefined
        // A delegated parent can enable the controller without moving Althar or any other existing process.
        parent = own === resolve(mount) ? own : dirname(own)
      }
      await files.writable(join(parent, 'cgroup.subtree_control'))
      const controllers = (await files.read(join(parent, 'cgroup.controllers'))).split(/\s+/)
      if (!controllers.includes('cpu')) return undefined
      await files.write(join(parent, 'cgroup.subtree_control'), '+cpu')
      const path = join(parent, `althar-${process.pid}-${randomUUID().slice(0, 8)}`)
      await files.make(path)
      try {
        await files.write(join(path, 'cpu.weight'), '10')
        await files.write(join(path, 'cgroup.subtree_control'), '+cpu')
      } catch (error) {
        await remove(path)
        throw error
      }
      return path
    } catch {
      return undefined
    }
  }
  const finish = async (generation: Generation, parent: string | undefined) => {
    if (--generation.users !== 0) return
    if (current === generation) current = undefined
    await Promise.allSettled(generation.retiring.values())
    if (parent !== undefined) await remove(parent)
  }
  return {
    acquire: async (owner) => {
      if (unavailable || !/^[a-zA-Z0-9_-]+$/.test(owner)) return undefined
      const generation = (current ??= { ready: prepare(), users: 0, workers: new Map(), retiring: new Map() })
      // Count pending acquisitions too: teardown must not remove their parent while they await IO.
      generation.users++
      let handedOff = false
      let parent: string | undefined
      try {
        parent = await generation.ready
        if (parent === undefined) {
          unavailable = true
          return undefined
        }
        const base = parent
        let pending: Promise<Worker | undefined>
        let group: Worker
        while (true) {
          const retiring = generation.retiring.get(owner)
          if (retiring !== undefined) {
            await retiring
            continue
          }
          pending =
            generation.workers.get(owner) ??
            (async () => {
              const path = join(base, owner)
              try {
                await files.make(path)
                await files.write(join(path, 'cpu.weight'), '100')
                return { path, refs: 0 }
              } catch {
                await remove(path)
                return undefined
              }
            })()
          generation.workers.set(owner, pending)
          const ready = await pending
          if (ready === undefined) {
            if (generation.workers.get(owner) === pending) generation.workers.delete(owner)
            return undefined
          }
          // The last old command may have released while this acquisition awaited either IO or an already-ready promise.
          // Claim a reference only while this is still the live worker; otherwise wait for its teardown and try again.
          if (generation.workers.get(owner) !== pending) continue
          group = ready
          break
        }
        group.refs++
        handedOff = true
        let released = false
        return {
          path: group.path,
          release: async () => {
            if (released) return
            released = true
            try {
              if (--group.refs !== 0) return
              if (generation.workers.get(owner) === pending) generation.workers.delete(owner)
              const done = (async () => {
                await files.write(join(group.path, 'cgroup.kill'), '1').catch(() => {})
                await remove(group.path)
              })()
              generation.retiring.set(owner, done)
              try {
                await done
              } finally {
                if (generation.retiring.get(owner) === done) generation.retiring.delete(owner)
              }
            } finally {
              await finish(generation, base)
            }
          },
        }
      } finally {
        if (!handedOff) await finish(generation, parent)
      }
    },
  }
}
