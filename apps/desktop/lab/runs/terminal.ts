import { terminalFolder } from './parts'
import { lab } from './state'
import { type Folder, world } from './world'

/*
 * How each direction opens a terminal: from the foot of Run's list, by
 * Ctrl+` from anywhere, and from a failed run, in the folder it ran in. B
 * and its spin-offs show it where they show a run; D and B3 open one from a
 * run beside it, so the failure and the fix are side by side.
 */

/** A terminal in a folder, where the direction keeps terminals; from a run, the run it was opened by. */
export const openTerminal = (folder: Folder = terminalFolder(), from?: string) => {
  const d = lab.get().d
  if (d === 'today') return
  if ((d === 'd' || d === 'b3') && from !== undefined) {
    world.openShell(folder, from)
    return world.show({ kind: 'run', id: from })
  }
  const shell = world.openShell(folder)
  world.show({ kind: 'shell', id: shell.id })
}

/** Ctrl+`: the terminal, or away from it again. */
export const toggleTerminal = () => {
  const d = lab.get().d
  const state = world.get()
  if (d === 'today') return
  if (d === 'd' && state.tab.current) return world.tabTo(false)
  if (d !== 'd' && state.open && (state.focus?.kind === 'shell' || d === 'b3')) return world.hide()
  const last = state.shells.at(-1)
  if (last !== undefined) return world.show({ kind: 'shell', id: last.id })
  openTerminal()
}
