import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { HostError } from '../errors'
import type { InstalledRelease } from './store'

export type UpdateExecutor = (program: string, args: ReadonlyArray<string>, signal?: AbortSignal) => Promise<string>
export const executeUpdate: UpdateExecutor = async (program, args, signal) => {
  try {
    const { stdout } = await promisify(execFile)(program, [...args], {
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
      ...(signal === undefined ? {} : { signal }),
      timeout: 180_000,
      maxBuffer: 131_072,
      windowsHide: true,
    })
    return stdout
  } catch {
    throw new HostError({
      code: 'UpdateFailed',
      message: 'A host update or service operation failed. Inspect its update status and the systemd journal.',
    })
  }
}
export const runRelease = (
  release: Pick<InstalledRelease, 'folder'>,
  args: ReadonlyArray<string>,
  execute: UpdateExecutor = executeUpdate,
  signal?: AbortSignal,
) => execute(join(release.folder, 'node/bin/node'), [join(release.folder, 'dist/althar-host.js'), ...args], signal)
export interface UpdateServices {
  readonly active: (name: string) => Promise<boolean>
  readonly stop: (name: string) => Promise<void>
  readonly start: (name: string) => Promise<void>
  readonly kick: (name: string) => Promise<void>
}
export const systemServices = (execute: UpdateExecutor = executeUpdate): UpdateServices => ({
  active: async (name) => {
    try {
      return (await execute('systemctl', ['--user', 'is-active', `${name}.service`])).trim() === 'active'
    } catch {
      return false
    }
  },
  stop: async (name) => {
    await execute('systemctl', ['--user', 'stop', `${name}.service`])
  },
  start: async (name) => {
    await execute('systemctl', ['--user', 'reset-failed', `${name}.service`])
    await execute('systemctl', ['--user', 'start', `${name}.service`])
  },
  kick: async (name) => {
    await execute('systemctl', ['--user', 'start', '--no-block', `${name}-update.service`])
  },
})
