import { join } from 'node:path'

/*
 * Simulators and emulators, read from what their own tools print (a
 * prototype of docs/decisions/proposed/107): Xcode's `simctl` for iOS, the
 * Android SDK's `emulator`, `adb` and `uiautomator` for Android. Nothing here
 * runs anything; Devices.ts runs the commands and hands their output here.
 */

export type DevicePlatform = 'ios' | 'android'

export const PLATFORMS: ReadonlyArray<DevicePlatform> = ['ios', 'android']

/** What a platform's word is on screen and to an agent. */
export const platformWord = (platform: DevicePlatform) => (platform === 'ios' ? 'iOS' : 'Android')

/** Whether this computer can run a platform's devices, and why not where it can't, said as the person would fix it. */
export type DeviceReach =
  | { readonly platform: DevicePlatform; readonly ready: true; readonly models: ReadonlyArray<DeviceModel> }
  | { readonly platform: DevicePlatform; readonly ready: false; readonly why: string }

/** A device one can be made from: an iOS simulator, an Android virtual device. */
export interface DeviceModel {
  /** simctl's udid, or the AVD's name. */
  readonly id: string
  readonly name: string
  /** iOS 18.2; an AVD says none until it runs. */
  readonly os: string | null
}

/** A simulator as `simctl list devices -j` lists it. */
export interface Simulator {
  readonly udid: string
  readonly name: string
  readonly os: string
  readonly state: string
  /** What `simctl create` makes another of: its device type and its runtime. */
  readonly type: string
  readonly runtime: string
}

/** What Althar names the simulators it makes, so it knows its own after a crash and never takes the person's. */
export const OURS = 'Althar · '

/** A simulator of Althar's own for an owner: `Althar · <owner>`. */
export const simulatorNameFor = (owner: string) => `${OURS}${owner}`

/** `com.apple.CoreSimulator.SimRuntime.iOS-18-2` as iOS 18.2; null for a runtime not of a phone or tablet (watchOS, tvOS, visionOS). */
export const iosRuntimeOf = (key: string): string | null => {
  const found = /SimRuntime\.iOS-(\d+)(?:-(\d+))?(?:-(\d+))?$/.exec(key)
  if (found === null) return null
  return `iOS ${[found[1], found[2], found[3]].filter((part) => part !== undefined).join('.')}`
}

/**
 * The iOS simulators `xcrun simctl list devices available -j` printed, newest iOS first, then by name; null where it
 * printed no list. Each runtime's devices sit under its key, and only iOS's are kept.
 */
export const simulatorsOf = (printed: string): ReadonlyArray<Simulator> | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(printed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const devices = (parsed as { readonly devices?: unknown }).devices
  if (typeof devices !== 'object' || devices === null) return null
  const found: Array<Simulator> = []
  for (const [key, list] of Object.entries(devices)) {
    const os = iosRuntimeOf(key)
    if (os === null || !Array.isArray(list)) continue
    for (const one of list as ReadonlyArray<Record<string, unknown>>) {
      const { udid, name, state, isAvailable, deviceTypeIdentifier } = one
      if (typeof udid !== 'string' || typeof name !== 'string' || typeof deviceTypeIdentifier !== 'string' || isAvailable === false)
        continue
      found.push({ udid, name, os, state: typeof state === 'string' ? state : 'Unknown', type: deviceTypeIdentifier, runtime: key })
    }
  }
  const version = (os: string) => os.replace('iOS ', '').split('.').map(Number)
  return found.toSorted((a, b) => {
    const [x, y] = [version(a.os), version(b.os)]
    for (let at = 0; at < Math.max(x.length, y.length); at += 1) {
      const step = (y[at] ?? 0) - (x[at] ?? 0)
      if (step !== 0) return step
    }
    return a.name.localeCompare(b.name)
  })
}

/** The simulators a device can be made from: the person's, never Althar's own copies; iPhones first, as a phone app's usual. */
export const iosModelsOf = (simulators: ReadonlyArray<Simulator>): ReadonlyArray<DeviceModel> => {
  const theirs = simulators.filter((one) => !one.name.startsWith(OURS))
  const phones = theirs.filter((one) => one.name.startsWith('iPhone'))
  return [...phones, ...theirs.filter((one) => !one.name.startsWith('iPhone'))].map((one) => ({ id: one.udid, name: one.name, os: one.os }))
}

/** The AVDs `emulator -list-avds` printed, one a line; what the emulator says of itself (`INFO | …`) is left out. */
export const avdsOf = (printed: string): ReadonlyArray<DeviceModel> =>
  printed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[\w.-]+$/.test(line))
    .map((name) => ({ id: name, name: name.replaceAll('_', ' '), os: null }))

/** A device `adb devices -l` listed: its serial and whether it answers (`device`), or is `offline`, `unauthorized` or booting. */
export interface Attached {
  readonly serial: string
  readonly state: string
}

export const attachedOf = (printed: string): ReadonlyArray<Attached> =>
  printed
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.startsWith('List of devices') && !line.startsWith('*'))
    .flatMap((line) => {
      const [serial, state] = line.trim().split(/\s+/)
      return serial === undefined || state === undefined ? [] : [{ serial, state }]
    })

/**
 * The console port for an emulator of Althar's own: the first even port from 5554 that no attached emulator has
 * (`emulator-5556` has 5556 and 5557, its adb port), or null where all 64 are taken.
 */
export const freeEmulatorPort = (attached: ReadonlyArray<Attached>, ours: ReadonlyArray<number> = []): number | null => {
  const taken = new Set([
    ...ours,
    ...attached.flatMap((one) => {
      const port = /^emulator-(\d+)$/.exec(one.serial)?.[1]
      return port === undefined ? [] : [Number(port)]
    }),
  ])
  for (let port = 5554; port <= 5680; port += 2) if (!taken.has(port)) return port
  return null
}

/** Where the Android SDK is: `ANDROID_HOME`, else `ANDROID_SDK_ROOT`, else where Android Studio puts it on each platform. */
export const androidSdkOf = (env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform, home: string): string => {
  const named = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT
  if (named !== undefined && named !== '') return named
  if (platform === 'darwin') return join(home, 'Library', 'Android', 'sdk')
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Android', 'Sdk')
  return join(home, 'Android', 'Sdk')
}

/** The SDK's two tools, by path, so a person's PATH never decides which. */
export const androidToolsOf = (sdk: string, platform: NodeJS.Platform) => ({
  emulator: join(sdk, 'emulator', platform === 'win32' ? 'emulator.exe' : 'emulator'),
  adb: join(sdk, 'platform-tools', platform === 'win32' ? 'adb.exe' : 'adb'),
})

/**
 * Whether `emulator -accel-check` found the computer's acceleration: KVM on Linux, the Hypervisor framework on a Mac,
 * WHPX or AEHD on Windows. Without it an emulator doesn't start, or takes many minutes to.
 */
export const accelerated = (code: number | null, printed: string) =>
  code === 0 && /\b(is installed and usable|usable)\b/i.test(printed) && !/\bnot (installed|usable)\b/i.test(printed)

/** What the person does where acceleration is missing, by platform. */
export const accelerationWhy = (platform: NodeJS.Platform) =>
  platform === 'linux'
    ? 'This computer has no KVM, which the Android emulator needs. A virtual machine or a container usually has none; on your own Linux, add yourself to the kvm group.'
    : platform === 'win32'
      ? 'The Android emulator needs Windows Hypervisor Platform, turned on in Windows Features.'
      : 'The Android emulator can’t use this Mac’s hypervisor.'

/** One element of a screen, as `uiautomator dump` wrote it, with a reference an agent taps by. */
export interface ScreenElement {
  readonly ref: string
  readonly role: string
  readonly words: string
  readonly id: string
  readonly center: { readonly x: number; readonly y: number }
  readonly tappable: boolean
}

const attribute = (tag: string, name: string) => {
  const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? ''
  return found
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#10;', ' ')
    .replaceAll('&amp;', '&')
}

/**
 * The elements worth naming of a `uiautomator dump`: those with words (text or a content description) or that take a
 * tap, in the order they are on screen, each `n1`, `n2`… The rest is layout. Empty where the dump is no hierarchy.
 */
export const screenOf = (xml: string): ReadonlyArray<ScreenElement> => {
  const found: Array<ScreenElement> = []
  for (const tag of xml.match(/<node\b[^>]*>/g) ?? []) {
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attribute(tag, 'bounds'))
    if (bounds === null) continue
    const [left, top, right, bottom] = bounds.slice(1, 5).map(Number) as [number, number, number, number]
    if (right <= left || bottom <= top) continue
    const words = (attribute(tag, 'text') || attribute(tag, 'content-desc')).trim()
    const tappable = attribute(tag, 'clickable') === 'true' || attribute(tag, 'long-clickable') === 'true'
    if (words === '' && !tappable) continue
    const kind = attribute(tag, 'class').split('.').at(-1) ?? 'View'
    found.push({
      ref: `n${found.length + 1}`,
      role: kind,
      words,
      id: attribute(tag, 'resource-id').split('/').at(-1) ?? '',
      center: { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) },
      tappable,
    })
  }
  return found
}

/** A screen as an agent reads it, a line an element: `[ref=n3] Button "Sign in" #sign_in (540, 1210) tap`. */
export const screenWords = (elements: ReadonlyArray<ScreenElement>) =>
  elements.length === 0
    ? 'Nothing on this screen has words or takes a tap. Take a screenshot to see it.'
    : elements
        .map(
          (one) =>
            `[ref=${one.ref}] ${one.role}${one.words === '' ? '' : ` "${one.words}"`}${one.id === '' ? '' : ` #${one.id}`} (${one.center.x}, ${one.center.y})${one.tappable ? ' tap' : ''}`,
        )
        .join('\n')

/**
 * Text as `adb shell input text` takes it: a space is `%s`, and what the device's shell would read (quotes, `&`, `;`,
 * brackets and the like) is escaped. One line at a time; a newline is a press of Enter, which the tool does itself.
 */
export const adbTextOf = (text: string) => text.replaceAll(/([\\"'`$&|;<>()[\]{}*?!~#%^])/g, '\\$1').replaceAll(' ', '%s')

/** The keys an agent presses on an Android device, as `input keyevent` names them. */
export const ANDROID_KEYS = {
  back: 'KEYCODE_BACK',
  home: 'KEYCODE_HOME',
  enter: 'KEYCODE_ENTER',
  delete: 'KEYCODE_DEL',
  tab: 'KEYCODE_TAB',
  menu: 'KEYCODE_MENU',
  recents: 'KEYCODE_APP_SWITCH',
} as const

export type DeviceKey = keyof typeof ANDROID_KEYS

/** The status bar every screenshot of an iOS simulator shows, as Apple's own pictures do: 9:41, full bars, charged. */
export const CLEAN_STATUS_BAR = [
  'override',
  '--time',
  '9:41',
  '--dataNetwork',
  'wifi',
  '--wifiMode',
  'active',
  '--wifiBars',
  '3',
  '--cellularMode',
  'active',
  '--cellularBars',
  '4',
  '--batteryState',
  'charged',
  '--batteryLevel',
  '100',
] as const

/** A PNG's size in pixels, read from its header; null where the bytes are no PNG. */
export const pngSizeOf = (base64: string): { readonly width: number; readonly height: number } | null => {
  const head = Buffer.from(base64.slice(0, 44), 'base64')
  if (head.length < 24 || head.toString('latin1', 1, 4) !== 'PNG' || head.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

/** The XML of a `uiautomator dump /dev/tty`, without the line it says after (`UI hierchary dumped to: /dev/tty`). */
export const dumpedXmlOf = (printed: string): string | null => {
  const start = printed.indexOf('<?xml')
  const end = printed.lastIndexOf('</hierarchy>')
  return start === -1 || end === -1 ? null : printed.slice(start, end + '</hierarchy>'.length)
}
