import type { ComputerAnswer, ComputerCall, ComputerPicture } from '@althar/runtime/computerBridge'

export interface NativeWindow {
  readonly pid: number
  readonly handle: string
  readonly app: string
  readonly title: string
}
export interface NativeApp {
  readonly name: string
  readonly path: string
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
