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

import { keyChord, type NativeApp, type NativeCall, type NativeResult, type NativeTarget, type NativeWindow } from './protocol'

const IMAGE_LIMIT = 16_000_000
const MAX_IMAGE_DIMENSION = 1700
const MAX_OBSERVATION_AGE = 60_000
const BUTTONS = { left: ClickButton.Left, middle: ClickButton.Middle, right: ClickButton.Right } as const

/** Only validation and guidance authored here may be returned to the task as an error. */
export class ComputerProblem extends Error {}

const LAUNCH_WAIT = 8_000
const MAX_APPS = 400

/**
 * A window a person could use: one with a title, or an untitled one on screen at the normal level and big enough to hold
 * something (an Electron app’s main window, a dialog), named by its app. Untitled slivers and overlays stay out.
 */
const windowOf = (one: WindowInfo): NativeWindow | null => {
  if (one.pid === undefined || one.pid <= 0 || one.pid === process.ppid) return null
  const title = one.title.trim()
  if (title === '' && !(one.isOnScreen && (one.layer ?? 0) === 0 && one.bounds.width >= 160 && one.bounds.height >= 100)) return null
  return { pid: one.pid, handle: String(one.windowId), app: one.appName.slice(0, 160), title: (title || one.appName).slice(0, 240) }
}

/** The driver’s reason for a refusal, where it gave one as a code: never its text, which can carry what is on screen. */
const codeOf = (result: { readonly errorCode?: string | undefined }) =>
  result.errorCode !== undefined && /^[a-z0-9_]{1,64}$/.test(result.errorCode) ? ` (${result.errorCode})` : ''

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
    if (window === undefined)
      throw new ComputerProblem(
        `${target.app}’s window "${target.title}" closed or changed. Request again to find its windows now, or launch ${target.app} to bring one back.`,
      )
    return window
  }

  const inventory = async () => {
    const windows = await driver.listWindows({})
    const apps = await driver.listApps({}).catch(() => ({ apps: [] }))
    return {
      windows: windows.windows.flatMap((one) => windowOf(one) ?? []).slice(0, 180),
      // Running apps too: one with no window open (closed to the menu bar, say) is found only here.
      apps: apps.apps
        .flatMap((app) =>
          app.launchPath || app.bundleId || app.running
            ? [
                {
                  name: app.name.slice(0, 160),
                  ...(app.launchPath === undefined ? {} : { path: app.launchPath }),
                  ...(app.bundleId === undefined ? {} : { bundleId: app.bundleId }),
                  running: app.running,
                },
              ]
            : [],
        )
        .slice(0, MAX_APPS),
    }
  }

  /** Its windows, once it shows one: an app just opened, or brought back from the menu bar, takes a moment to draw it. */
  const windowsOf = async (pid: number, until: number) => {
    for (;;) {
      const listed = await driver.listWindows({ pid })
      const windows = listed.windows.flatMap((one) => windowOf(one) ?? [])
      if (windows.length > 0 || Date.now() >= until) return windows
      await wait(250)
    }
  }

  const launch = async (app: NativeApp): Promise<NativeResult> => {
    const started = Date.now()
    const result = await driver.callTool(
      'launch_app',
      JSON.stringify(app.bundleId !== undefined ? { bundle_id: app.bundleId } : { name: app.path ?? app.name }),
    )
    if (result.isError)
      throw new ComputerProblem(
        `${app.name} didn’t open${codeOf(result)}. Check its name against the apps that status lists, or open it from Spotlight: key ["cmd","space"] to "desktop", then type its name and key ["return"].`,
      )
    const info = JSON.parse(result.structuredJson ?? '{}') as { readonly pid?: unknown }
    if (typeof info.pid !== 'number' || !Number.isSafeInteger(info.pid) || info.pid < 1) return { kind: 'launched', windows: [] }
    const pid = info.pid
    let windows = await windowsOf(pid, started + LAUNCH_WAIT / 2)
    // Running with no window, as an app closed to the menu bar is: bring it forward, as a person clicking it in the Dock does.
    if (windows.length === 0) {
      await driver.callTool('bring_to_front', JSON.stringify({ pid })).catch(() => undefined)
      windows = await windowsOf(pid, started + LAUNCH_WAIT)
    }
    return { kind: 'launched', windows }
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
      const size = width && height ? ` Screenshot ${width}x${height}: its pixels are the coordinates for input to "desktop".` : ''
      return { kind: 'observed', observation: id, answer: { text: `Observation ${id} of the primary display.${size}` }, picture, frame }
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
    if (call.op === 'launch') return launch(call.app)

    const { target, action, foreground } = call
    const live = await current(target)
    const key = target === 'desktop' ? target : target.handle
    const seen = observations.get(key)
    const name = target === 'desktop' ? 'the display' : target.app
    const again = `Observe ${target === 'desktop' ? '"desktop"' : 'it'} again and use the observation id that returns.`
    if (seen === undefined) throw new ComputerProblem(`There is no observation of ${name} to act on. ${again}`)
    if (seen.id !== action.observation)
      throw new ComputerProblem(
        `observation ${action.observation} isn’t the latest of ${name}: each input spends its observation, and only the latest counts. ${again}`,
      )
    if (Date.now() - seen.at > MAX_OBSERVATION_AGE) throw new ComputerProblem(`The observation of ${name} is over a minute old. ${again}`)
    if (live !== null && (seen.bounds === null || !sameBounds(live.bounds, seen.bounds)))
      throw new ComputerProblem(`${name}’s window moved or resized since it was observed. ${again}`)
    const position = (point: { readonly element: string } | { readonly x: number; readonly y: number }) => {
      if ('element' in point) {
        const token = seen.elements.get(point.element)
        if (token === undefined)
          throw new ComputerProblem(
            target === 'desktop'
              ? 'An observation of "desktop" is a picture without elements: give a point, {"x":…,"y":…}, read off its screenshot.'
              : `${point.element} isn’t an element of the latest observation of ${name}. Use a reference it listed, or a point on its screenshot.`,
          )
        return { element_token: token }
      }
      if (seen.pixels === null)
        throw new ComputerProblem(
          `The latest observation of ${name} has no screenshot to place a point on. Observe it with screenshot: true.`,
        )
      if (point.x >= seen.pixels.width || point.y >= seen.pixels.height)
        throw new ComputerProblem(
          `(${point.x}, ${point.y}) is outside the screenshot of ${name}, which is ${seen.pixels.width}x${seen.pixels.height}. Read the point off that screenshot.`,
        )
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
        case 'key': {
          const chord = keyChord(action.keys)
          if (chord === null)
            throw new ComputerProblem(
              `keys ${JSON.stringify(action.keys)} need exactly one key besides the modifiers, such as ["return"] or ["cmd","space"]. Press keys one call at a time.`,
            )
          // The driver’s hotkey takes a chord only; a single key, Return or Escape, is a key press.
          return chord.modifiers.length === 0
            ? driver.callTool('press_key', JSON.stringify({ ...common, key: chord.key }))
            : driver.callTool('hotkey', JSON.stringify({ ...common, keys: [...chord.modifiers, chord.key] }))
        }
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
    if (result.isError) {
      if (!foreground && result.errorCode === 'background_unavailable')
        throw new ComputerProblem(
          `${name} doesn’t take this ${action.op} in the background. Observe it again and send it with foreground: true.`,
        )
      throw new ComputerProblem(
        `The driver refused that ${action.op} on ${name}${codeOf(result)}. Observe ${target === 'desktop' ? '"desktop"' : 'it'} to see where things stand before retrying.`,
      )
    }
    return { kind: 'acted', answer: { text: 'Input was attempted. Observe and verify the intended outcome.' } }
  }

  return { run }
}
