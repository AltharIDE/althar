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

/**
 * What the driver's launch_app takes on each system: macOS a bundle id, or a name or `.app` path; Linux and Windows the
 * path the list gave (launch_path), or a name. Linux lists every app with an XDG id as its bundle id, which its launch ignores.
 */
export const launchArguments = (app: NativeApp, platform: NodeJS.Platform): Record<string, string> => {
  if (platform === 'darwin') return app.bundleId !== undefined ? { bundle_id: app.bundleId } : { name: app.path ?? app.name }
  if (app.path !== undefined) return { launch_path: app.path }
  // A packaged Windows app is known by its user model id.
  if (platform === 'win32' && app.bundleId !== undefined) return { bundle_id: app.bundleId }
  return { name: app.name }
}

/**
 * The processes that show the system's own security prompts: granting an app a permission, an administrator's password,
 * Touch ID, opening an app from the internet. Answering one is the person's alone, beyond what a turn's approval covers.
 */
const SYSTEM_PROMPTS = new Set([
  'SecurityAgent',
  'UserNotificationCenter',
  'universalAccessAuthWarn',
  'CoreServicesUIAgent',
  'coreautha',
  'LocalAuthenticationRemoteService',
  'AuthenticationServicesAgent',
  'tccd',
  'consent.exe',
  'CredentialUIBroker.exe',
])
export const isSystemPrompt = (app: string) => SYSTEM_PROMPTS.has(app)

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
