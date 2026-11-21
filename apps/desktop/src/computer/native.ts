import { randomUUID } from 'node:crypto'

import type { ComputerPicture } from '@althar/runtime/computerBridge'
import {
  ActionEffect,
  ActionTarget,
  ClickButton,
  ClickPosition,
  CuaDriver,
  InputDeliveryMode,
  type WindowBounds,
  type WindowInfo,
} from '@trycua/cua-driver'

import sharp from 'sharp'

import type { NativeCall, NativeResult, NativeTarget, NativeWindow } from './protocol'

const IMAGE_LIMIT = 16_000_000
const MAX_IMAGE_DIMENSION = 1700
const MAX_OBSERVATION_AGE = 60_000
const BUTTONS = { left: ClickButton.Left, middle: ClickButton.Middle, right: ClickButton.Right } as const

/** Only validation and guidance authored here may be returned to the task as an error. */
export class ComputerProblem extends Error {}

const windowOf = (one: WindowInfo): NativeWindow | null =>
  one.pid === undefined || one.pid <= 0 || one.pid === process.ppid || one.title.trim() === ''
    ? null
    : { pid: one.pid, handle: String(one.windowId), app: one.appName.slice(0, 160), title: one.title.slice(0, 240) }

const sameBounds = (one: WindowBounds, other: WindowBounds) =>
  one.x === other.x && one.y === other.y && one.width === other.width && one.height === other.height

const pictureOf = (image: { readonly mimeType: string; readonly dataBase64: string } | undefined): ComputerPicture | undefined =>
  image === undefined || (image.mimeType !== 'image/png' && image.mimeType !== 'image/jpeg') || image.dataBase64.length > IMAGE_LIMIT
    ? undefined
    : { data: image.dataBase64, mimeType: image.mimeType }

interface Observation {
  readonly id: string
  readonly at: number
  readonly bounds: WindowBounds | null
  readonly pixels: { readonly width: number; readonly height: number } | null
  readonly elements: ReadonlyMap<string, string>
}

export const nativeComputer = () => {
  // The runtime never owns native permissions. This process is a disposable child of the desktop app.
  const driver = CuaDriver.create({ embedded: true, claudeCodeCompatibility: false })
  const observations = new Map<string, Observation>()

  const current = async (target: NativeTarget) => {
    if (target === 'desktop') return null
    if (target.pid === process.ppid) throw new ComputerProblem('The task cannot control Althar’s own window.')
    const { windows } = await driver.listWindows({ pid: target.pid })
    const window = windows.find(
      (one) => String(one.windowId) === target.handle && one.pid === target.pid && one.appName.slice(0, 160) === target.app,
    )
    if (window === undefined) throw new ComputerProblem('That window closed or changed ownership. Ask the person to select it again.')
    return window
  }

  const inventory = async () => {
    const windows = await driver.listWindows({})
    const apps = await driver.listApps({}).catch(() => ({ apps: [] }))
    return {
      windows: windows.windows.flatMap((one) => windowOf(one) ?? []).slice(0, 180),
      apps: apps.apps
        .flatMap((app) => (app.launchPath && !app.running ? [{ name: app.name.slice(0, 160), path: app.launchPath }] : []))
        .slice(0, 180),
    }
  }

  const observe = async (target: NativeTarget, screenshot: boolean): Promise<NativeResult> => {
    const id = randomUUID()
    if (target === 'desktop') {
      const result = await driver.getDesktopState({ maxImageDimension: MAX_IMAGE_DIMENSION })
      const picture = pictureOf(result.images[0])
      if (result.isError || picture === undefined) throw new ComputerProblem('Althar could not capture the primary display.')
      const { width, height } = await sharp(Buffer.from(picture.data, 'base64')).metadata()
      const frame = { width, height }
      observations.set(target, {
        id,
        at: Date.now(),
        bounds: null,
        pixels: width && height ? frame : null,
        elements: new Map(),
      })
      return { kind: 'observed', observation: id, answer: { text: `Observation ${id} of the primary display.` }, picture, frame }
    }
    const live = await current(target)
    if (live === null) throw new ComputerProblem('That window is unavailable.')
    const state = await driver.getWindowState({
      pid: target.pid,
      windowId: BigInt(target.handle),
      includeScreenshot: screenshot,
      includeAccessibilityTree: true,
      treeFormat: 'elements',
      maxElements: 220,
      timeoutMs: 1500,
      maxImageDimension: MAX_IMAGE_DIMENSION,
    })
    const elements = new Map<string, string>()
    const lines: Array<string> = []
    for (const one of state.elements ?? []) {
      if (one.isPassword) {
        lines.push(`${one.role} (secure input, use handoff)`)
        continue
      }
      const ref = one.elementToken === undefined ? '' : `e${elements.size + 1}`
      if (one.elementToken !== undefined) elements.set(ref, one.elementToken)
      lines.push(
        `${ref} ${one.role} ${JSON.stringify((one.label ?? '').slice(0, 240))} ${JSON.stringify((one.value ?? '').slice(0, 300))}`.trim(),
      )
    }
    for (const one of state.observations ?? []) lines.push(`${one.role} ${JSON.stringify((one.label ?? one.value ?? '').slice(0, 300))}`)
    if (state.degradedReason === 'screen_locked') throw new ComputerProblem('The screen locked. Ask the person to unlock it.')
    const picture =
      state.screenshotFrameValid === false || state.elements?.some((one) => one.isPassword) === true
        ? undefined
        : pictureOf(state.images[0])
    const pixels =
      picture !== undefined && state.screenshotWidth !== undefined && state.screenshotHeight !== undefined
        ? { width: state.screenshotWidth, height: state.screenshotHeight }
        : null
    observations.set(target.handle, { id, at: Date.now(), bounds: live.bounds, pixels, elements })
    return {
      kind: 'observed',
      observation: id,
      answer: {
        text: [
          `Observation ${id} of ${target.app}.`,
          ...(pixels === null ? [] : [`Screenshot ${pixels.width}x${pixels.height}.`]),
          ...lines,
        ]
          .join('\n')
          .slice(0, 22_000),
      },
      ...(picture === undefined ? {} : { picture }),
    }
  }

  const run = async (call: NativeCall): Promise<NativeResult> => {
    if (!driver.isAvailable()) throw new ComputerProblem('The native computer-use driver is unavailable in this graphical session.')
    if (call.op === 'inventory') return { kind: 'inventory', value: await inventory() }
    if (call.op === 'observe') return observe(call.target, call.screenshot)
    if (call.op === 'launch') {
      const result = await driver.callTool('launch_app', JSON.stringify({ launch_path: call.app.path }))
      if (result.isError) throw new ComputerProblem('The approved app did not open.')
      const info = JSON.parse(result.structuredJson ?? '{}') as { readonly pid?: unknown }
      if (typeof info.pid !== 'number' || !Number.isSafeInteger(info.pid) || info.pid < 1) return { kind: 'launched', windows: [] }
      const listed = await driver.listWindows({ pid: info.pid })
      return { kind: 'launched', windows: listed.windows.flatMap((one) => windowOf(one) ?? []) }
    }

    const { target, action, foreground } = call
    const live = await current(target)
    const key = target === 'desktop' ? target : target.handle
    const seen = observations.get(key)
    if (
      seen === undefined ||
      seen.id !== action.observation ||
      Date.now() - seen.at > MAX_OBSERVATION_AGE ||
      (live !== null && (seen.bounds === null || !sameBounds(live.bounds, seen.bounds)))
    )
      throw new ComputerProblem('That observation is stale. Observe the target again before sending input.')
    const position = (point: { readonly element: string } | { readonly x: number; readonly y: number }) => {
      if ('element' in point) {
        const token = seen.elements.get(point.element)
        if (token === undefined) throw new ComputerProblem('That element is not in the latest observation.')
        return { element_token: token }
      }
      if (seen.pixels === null || point.x >= seen.pixels.width || point.y >= seen.pixels.height)
        throw new ComputerProblem('That point is outside the latest screenshot. Observe with a screenshot first.')
      return point
    }
    const native =
      target === 'desktop'
        ? ({ kind: 'desktop', display_id: 'primary' } as const)
        : ({ kind: 'window', pid: target.pid, window_id: Number(target.handle) } as const)
    if (target !== 'desktop' && !Number.isSafeInteger(native.kind === 'window' ? native.window_id : 0))
      throw new ComputerProblem('That window cannot accept this action.')
    const delivery_mode = foreground ? 'foreground' : 'background'
    const common = { target: native, delivery_mode }
    // Every action spends its observation, including an action whose effect is uncertain.
    observations.delete(key)
    if (action.op === 'click') {
      const at = position(action.at)
      const result = await driver.click({
        target:
          target === 'desktop'
            ? ActionTarget.Desktop.new({ displayId: 'primary' })
            : ActionTarget.Window.new({ pid: target.pid, windowId: BigInt(target.handle) }),
        position: 'element_token' in at ? ClickPosition.Element.new({ elementToken: at.element_token }) : ClickPosition.Coordinates.new(at),
        deliveryMode: foreground ? InputDeliveryMode.Foreground : InputDeliveryMode.Background,
        button: BUTTONS[action.button ?? 'left'],
        count: action.double === true ? 2 : 1,
      })
      return {
        kind: 'acted',
        answer: {
          text:
            result.effect === ActionEffect.Confirmed
              ? 'The driver confirmed the action. Observe and verify the intended outcome.'
              : 'Input was attempted. Observe and verify the outcome before retrying.',
        },
      }
    }
    const result = await (async () => {
      switch (action.op) {
        case 'type':
          return driver.callTool(
            'type_text',
            JSON.stringify({ ...common, text: action.text, ...(action.at === undefined ? {} : position(action.at)) }),
          )
        case 'key':
          return driver.callTool('hotkey', JSON.stringify({ ...common, keys: action.keys }))
        case 'scroll':
          return driver.callTool('scroll', JSON.stringify({ ...common, ...position(action.at), direction: action.direction }))
        case 'drag': {
          position(action.from)
          position(action.to)
          return driver.callTool(
            'drag',
            JSON.stringify({ ...common, from_x: action.from.x, from_y: action.from.y, to_x: action.to.x, to_y: action.to.y }),
          )
        }
      }
    })()
    if (result.isError) throw new ComputerProblem('The driver could not confirm that action. Observe the app before retrying.')
    return { kind: 'acted', answer: { text: 'Input was attempted. Observe and verify the intended outcome.' } }
  }

  return { run }
}
