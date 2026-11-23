import type { ComputerAnswer, ComputerCall, ComputerPicture } from '@althar/runtime/computerBridge'

export interface NativeWindow {
  readonly pid: number
  readonly handle: string
  readonly app: string
  readonly title: string
}
export interface NativeApp {
  readonly name: string
  readonly path?: string | undefined
  readonly bundleId?: string | undefined
  readonly running?: boolean | undefined
}

const MODIFIERS = new Set(['cmd', 'shift', 'option', 'ctrl', 'fn'])
const ALIASES: Readonly<Record<string, string>> = {
  command: 'cmd',
  meta: 'cmd',
  super: 'cmd',
  control: 'ctrl',
  alt: 'option',
  opt: 'option',
  enter: 'return',
  esc: 'escape',
  del: 'delete',
  backspace: 'delete',
  spacebar: 'space',
}

/** Keys as a lead gives them (["cmd","space"], ["cmd+space"], ["Return"]): the modifiers held, and the one key pressed. */
export const keyChord = (keys: ReadonlyArray<string>) => {
  const all = keys
    .flatMap((one) => one.split('+'))
    .filter((one) => one !== '')
    .map((one) => one.toLowerCase())
    .map((one) => ALIASES[one] ?? one)
  const modifiers = [...new Set(all.filter((one) => MODIFIERS.has(one)))]
  const pressed = all.filter((one) => !MODIFIERS.has(one))
  return pressed.length === 1 ? { modifiers, key: pressed[0]! } : null
}
export interface NativeInventory {
  readonly windows: ReadonlyArray<NativeWindow>
  readonly apps: ReadonlyArray<NativeApp>
}

export type NativeTarget = NativeWindow | 'desktop'
export type NativeAction = Extract<ComputerCall, { op: 'click' | 'type' | 'key' | 'scroll' | 'drag' }>
export interface NativeFrame {
  readonly width: number
  readonly height: number
}

export type NativeCall =
  | { readonly op: 'inventory' }
  /** Opens the app, or brings back the window of one already running, as a person opening it would. */
  | { readonly op: 'launch'; readonly app: NativeApp }
  | { readonly op: 'observe'; readonly target: NativeTarget; readonly screenshot: boolean }
  | { readonly op: 'act'; readonly target: NativeTarget; readonly action: NativeAction; readonly foreground: boolean }

export type NativeResult =
  | { readonly kind: 'inventory'; readonly value: NativeInventory }
  | { readonly kind: 'launched'; readonly windows: ReadonlyArray<NativeWindow> }
  | {
      readonly kind: 'observed'
      readonly observation: string
      readonly answer: ComputerAnswer
      readonly picture?: ComputerPicture
      readonly frame?: NativeFrame
    }
  | { readonly kind: 'acted'; readonly answer: ComputerAnswer }

export type NativeReply = { readonly id: string; readonly value: NativeResult } | { readonly id: string; readonly error: string }
