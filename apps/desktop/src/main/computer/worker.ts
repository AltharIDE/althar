import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { utilityProcess, type UtilityProcess } from 'electron'

import type { NativeCall, NativeReply, NativeResult } from '../../computer/protocol'

const CALL_LIMIT = 20_000
const DESKTOP_ENV =
  /^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|XDG_CURRENT_DESKTOP|XDG_SESSION_DESKTOP|XDG_SESSION_TYPE|XDG_DATA_HOME|XDG_DATA_DIRS|HYPRLAND_INSTANCE_SIGNATURE|SWAYSOCK|NIRI_SOCKET|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PATH|LANG|LANGUAGE|LC_.*|LD_LIBRARY_PATH|SYSTEMROOT|WINDIR|TMPDIR|TEMP|TMP)$/i

export interface ComputerWorker {
  readonly run: (call: NativeCall) => Promise<NativeResult>
  readonly stop: () => Promise<void>
}

export const computerWorker = (here: string): ComputerWorker => {
  let child: UtilityProcess | undefined
  let closing: Promise<void> | undefined
  const pending = new Map<string, { settle: (result: NativeReply) => void; timer: ReturnType<typeof setTimeout> }>()

  const gone = (reason: string) => {
    for (const [id, one] of pending) {
      clearTimeout(one.timer)
      one.settle({ id, error: reason })
    }
    pending.clear()
  }
  const stop = (): Promise<void> => {
    const ending = child
    if (ending === undefined) return closing ?? Promise.resolve()
    child = undefined
    closing = new Promise<void>((resolve) => {
      ending.once('exit', () => {
        closing = undefined
        gone('Computer use stopped. Check the app before trying again.')
        resolve()
      })
      if (!ending.kill()) ending.once('spawn', () => ending.kill())
    })
    return closing
  }
  const start = () => {
    if (child !== undefined) return child
    const next = utilityProcess.fork(join(here, '../computer/worker.js'), [], {
      serviceName: 'Althar Computer Use',
      stdio: 'pipe',
      // Native driver setup follows the graphical session and the per-user OS permissions.
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([name]) => DESKTOP_ENV.test(name))),
        CUA_DRIVER_RS_ENABLE_WAYLAND: '1',
        DO_NOT_TRACK: '1',
      },
    })
    // The driver can log UI data. Drain its streams without copying them into Althar's logs.
    next.stdout?.resume()
    next.stderr?.resume()
    next.on('message', (reply: NativeReply) => {
      if (child !== next || typeof reply?.id !== 'string') return
      const call = pending.get(reply.id)
      if (call === undefined) return
      clearTimeout(call.timer)
      pending.delete(reply.id)
      call.settle(reply)
    })
    next.once('exit', () => {
      if (child !== next) return
      child = undefined
      gone('The native helper exited. Check the app before trying again.')
    })
    child = next
    return next
  }

  const run = async (call: NativeCall): Promise<NativeResult> => {
    if (closing !== undefined) await closing
    const next = start()
    const id = randomUUID()
    const reply = await new Promise<NativeReply>((settle) => {
      const timer = setTimeout(() => void stop(), CALL_LIMIT)
      pending.set(id, { settle, timer })
      try {
        next.postMessage({ id, call })
      } catch {
        void stop()
      }
    })
    if ('error' in reply) throw new Error(reply.error)
    return reply.value
  }
  return { run, stop }
}
