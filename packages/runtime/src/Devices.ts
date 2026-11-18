import { Ledger } from '@althar/persistence-sqlite'
import { Clock, Context, Duration, Effect, Layer, Schedule, Semaphore, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'
import type { DeviceCommand, DeviceHost } from './deviceHost'
import {
  accelerated,
  accelerationWhy,
  ANDROID_KEYS,
  adbTextOf,
  androidSdkOf,
  androidToolsOf,
  attachedOf,
  avdsOf,
  CLEAN_STATUS_BAR,
  type DeviceKey,
  type DeviceModel,
  type DevicePlatform,
  type DeviceReach,
  dumpedXmlOf,
  freeEmulatorPort,
  iosModelsOf,
  OURS,
  platformWord,
  pngSizeOf,
  type ScreenElement,
  screenOf,
  screenWords,
  simulatorNameFor,
  simulatorsOf,
} from './deviceOutput'
import { pageOwnerOf } from './PageTools'
import { settling } from './settled'
import { POOL, type Tool, type ToolAccess, ToolRefused, type ToolPicture, ToolServer } from './ToolServer'

/*
 * A device of its own beside each task: an iOS simulator or an Android
 * emulator its lead starts, installs on, drives and screenshots, as it does
 * the page beside it (a prototype of docs/decisions/proposed/107).
 *
 * - **Each owner gets its own device,** never the person's: an iOS simulator
 *   Althar makes (`Althar · <task>`) from the model asked for, or an Android
 *   virtual device run read-only, so several tasks run the same AVD at once.
 * - **It goes with its task:** shut down and deleted when the task is done or
 *   abandoned, and when Althar quits. Simulators named as Althar's that
 *   outlived a crash are deleted the first time one is made.
 * - **Commands run off the runtime's thread** (deviceHost.ts), outside the
 *   agent's sandbox, where CoreSimulator's services and adb's server are
 *   out of reach.
 * - **Android is driven whole**: its screen read as elements with references
 *   (`uiautomator`), taps, typing and keys. An iOS simulator is started,
 *   installed on, opened at a link and screenshotted; reading and tapping
 *   its screen needs a driver (Maestro, idb), not in this prototype.
 */

/** How many devices run at once on this computer: each takes 1.5 to 4 GB. */
export const MOST_DEVICES = 3

/** How long a device has to boot: a cold Android emulator can take two minutes. */
const BOOTING = Duration.minutes(3)

/** The lines of a device's log an agent gets at most. */
const MOST_LINES = 300

export interface OpenDevice {
  readonly owner: string
  readonly platform: DevicePlatform
  /** The simulator's udid, or the emulator's serial (`emulator-5556`). */
  readonly id: string
  readonly model: string
  readonly os: string | null
  readonly startedAt: number
}

interface Running extends OpenDevice {
  readonly stop: Effect.Effect<void>
  /** The screen as last read, for its references. */
  screen: ReadonlyArray<ScreenElement>
}

type Input = Readonly<Record<string, unknown>>

const recordOf = (input: unknown): Input => (typeof input === 'object' && input !== null ? (input as Input) : {})

const textIn = (input: Input, key: string): string | null => {
  const value = input[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

const refuse = (message: string) => Effect.fail(new ToolRefused({ message }))

/** What a device is called to an agent and the person: `iPhone 16 · iOS 18.2`. */
const named = (device: OpenDevice) => `${device.model}${device.os === null ? '' : ` · ${device.os}`}`

export class Devices extends Context.Service<
  Devices,
  {
    /** What this computer can run, platform by platform, with why not where it can't. */
    reach(): Effect.Effect<ReadonlyArray<DeviceReach>>
    /** The devices running for an owner. */
    of(owner: string): Effect.Effect<ReadonlyArray<OpenDevice>>
    /** Brings an iOS simulator's window to the front, for the person; whether it could. */
    show(owner: string, platform: DevicePlatform): Effect.Effect<boolean>
    /** Shuts down and deletes every device an owner has. */
    close(owner: string): Effect.Effect<void>
  }
>()('@althar/runtime/Devices') {
  static readonly layer: Layer.Layer<Devices, never, RuntimeConfig | ToolServer | SqlClient.SqlClient | Ledger> = Layer.effect(
    Devices,
    Effect.gen(function* () {
      const config = yield* RuntimeConfig
      const toolServer = yield* ToolServer
      const context = yield* Effect.context<SqlClient.SqlClient | Ledger>()
      const host: DeviceHost | undefined = config.devices
      const running = new Map<string, Running>()
      const keyOf = (owner: string, platform: DevicePlatform) => `${owner} ${platform}`
      // Devices start and stop one at a time: two starts at once would take the same port, or race to the same name.
      const lock = yield* Semaphore.make(1)
      let swept = false

      const xcrun = (...args: ReadonlyArray<string>): DeviceCommand => ({ command: 'xcrun', args: ['simctl', ...args] })
      const android = (here: DeviceHost) => androidToolsOf(androidSdkOf(here.env, here.platform, here.home), here.platform)
      const adb = (here: DeviceHost, serial: string, ...args: ReadonlyArray<string>): DeviceCommand => ({
        command: android(here).adb,
        args: ['-s', serial, ...args],
      })

      /** Runs a command, failing with what it said where it doesn't succeed. */
      const must = (here: DeviceHost, command: DeviceCommand) =>
        Effect.flatMap(here.run(command), (done) =>
          done.code === 0
            ? Effect.succeed(done.stdout)
            : refuse(
                `${command.args.slice(0, 2).join(' ')} failed: ${(done.stderr || done.stdout).trim().split('\n').slice(-3).join(' ') || `it exited ${String(done.code)}`}`,
              ),
        )

      const iosReach = (here: DeviceHost): Effect.Effect<DeviceReach> =>
        Effect.gen(function* () {
          if (here.platform !== 'darwin') return { platform: 'ios', ready: false, why: 'iOS simulators run only on a Mac, with Xcode.' }
          const listed = yield* here.run(xcrun('list', 'devices', 'available', '-j'))
          if (listed.missing || listed.code !== 0)
            return { platform: 'ios', ready: false, why: 'Install Xcode from the App Store, then open it once to finish setting up.' }
          const simulators = simulatorsOf(listed.stdout) ?? []
          const models = iosModelsOf(simulators)
          return models.length === 0
            ? { platform: 'ios', ready: false, why: 'Xcode has no iOS simulator. Add one in Xcode › Settings › Components.' }
            : { platform: 'ios', ready: true, models }
        })

      const androidReach = (here: DeviceHost): Effect.Effect<DeviceReach> =>
        Effect.gen(function* () {
          const tools = android(here)
          const listed = yield* here.run({ command: tools.emulator, args: ['-list-avds'] })
          if (listed.missing)
            return {
              platform: 'android',
              ready: false,
              why: 'Install Android Studio, or the Android SDK with its emulator, or set ANDROID_HOME to where it is.',
            }
          const models = avdsOf(listed.stdout)
          if (models.length === 0)
            return {
              platform: 'android',
              ready: false,
              why: 'The Android SDK has no virtual device. Make one in Android Studio’s Device Manager.',
            }
          const check = yield* here.run({ command: tools.emulator, args: ['-accel-check'] })
          if (!accelerated(check.code, `${check.stdout}\n${check.stderr}`))
            return { platform: 'android', ready: false, why: accelerationWhy(here.platform) }
          return { platform: 'android', ready: true, models }
        })

      const reach = (here: DeviceHost) => Effect.all([iosReach(here), androidReach(here)], { concurrency: 2 })

      /** The model asked for, by name or id, else the first; null where none is like it. */
      const modelOf = (models: ReadonlyArray<DeviceModel>, asked: string | null): DeviceModel | null => {
        if (asked === null) return models[0] ?? null
        const wanted = asked.toLowerCase()
        return (
          models.find((one) => one.id.toLowerCase() === wanted || one.name.toLowerCase() === wanted) ??
          models.find((one) => one.name.toLowerCase().includes(wanted)) ??
          null
        )
      }

      /** Deletes simulators named as Althar's that none of these devices is: what a crash left. */
      const sweep = (here: DeviceHost) =>
        Effect.gen(function* () {
          if (swept) return
          swept = true
          const listed = yield* here.run(xcrun('list', 'devices', '-j'))
          const ours = new Set([...running.values()].map((one) => one.id))
          for (const left of simulatorsOf(listed.stdout) ?? [])
            if (left.name.startsWith(OURS) && !ours.has(left.udid)) {
              if (left.state !== 'Shutdown') yield* here.run(xcrun('shutdown', left.udid))
              yield* here.run(xcrun('delete', left.udid))
            }
        })

      const startIos = (here: DeviceHost, owner: string, model: DeviceModel) =>
        Effect.gen(function* () {
          yield* sweep(here)
          const listed = simulatorsOf(yield* must(here, xcrun('list', 'devices', 'available', '-j'))) ?? []
          const like = listed.find((one) => one.udid === model.id)
          if (like === undefined) return yield* refuse(`${model.name} is no longer one of Xcode’s simulators.`)
          // A new simulator of the same model and iOS, never the person's own: nothing of theirs is booted, changed or erased.
          const udid = (yield* must(here, xcrun('create', simulatorNameFor(owner), like.type, like.runtime))).trim()
          const stop = Effect.asVoid(Effect.andThen(here.run(xcrun('shutdown', udid)), here.run(xcrun('delete', udid))))
          yield* Effect.gen(function* () {
            yield* must(here, xcrun('boot', udid))
            yield* must(here, xcrun('bootstatus', udid, '-b'))
            yield* here.run(xcrun('status_bar', udid, ...CLEAN_STATUS_BAR))
          }).pipe(
            Effect.timeoutOrElse({ duration: BOOTING, orElse: () => refuse(`${model.name} didn’t finish starting in three minutes.`) }),
            Effect.onError(() => stop),
          )
          return { id: udid, stop, os: like.os }
        })

      const startAndroid = (here: DeviceHost, model: DeviceModel) =>
        Effect.gen(function* () {
          const tools = android(here)
          const attached = attachedOf(yield* must(here, { command: tools.adb, args: ['devices', '-l'] }))
          const ours = [...running.values()].flatMap((one) => (one.platform === 'android' ? [Number(one.id.replace('emulator-', ''))] : []))
          const port = freeEmulatorPort(attached, ours)
          if (port === null) return yield* refuse('Every emulator port on this computer is taken.')
          const serial = `emulator-${port}`
          // Read-only: the AVD is left as it was, and several tasks can run the same one at once.
          const started = yield* here
            .start({
              command: tools.emulator,
              args: [
                '-avd',
                model.id,
                '-read-only',
                '-no-window',
                '-no-audio',
                '-no-boot-anim',
                '-no-snapshot-save',
                '-port',
                String(port),
              ],
            })
            .pipe(Effect.mapError((why) => new ToolRefused({ message: `The emulator didn’t start: ${why}` })))
          const stop = Effect.asVoid(Effect.andThen(here.run(adb(here, serial, 'emu', 'kill')), started.stop))
          const os = yield* Effect.gen(function* () {
            yield* must(here, adb(here, serial, 'wait-for-device'))
            // The device answers long before Android has started: wait for it to say so.
            yield* Effect.repeat(here.run(adb(here, serial, 'shell', 'getprop', 'sys.boot_completed')), {
              until: (done) => done.stdout.trim() === '1',
              schedule: Schedule.spaced(Duration.seconds(1)),
            })
            const release = (yield* here.run(adb(here, serial, 'shell', 'getprop', 'ro.build.version.release'))).stdout.trim()
            return release === '' ? null : `Android ${release}`
          }).pipe(
            Effect.timeoutOrElse({ duration: BOOTING, orElse: () => refuse(`${model.name} didn’t finish starting in three minutes.`) }),
            Effect.onError(() => stop),
          )
          return { id: serial, stop, os }
        })

      const open = (here: DeviceHost, owner: string, platform: DevicePlatform, asked: string | null) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const already = running.get(keyOf(owner, platform))
            if (already !== undefined) return `${named(already)} is already running beside you (${already.id}).`
            if (running.size >= MOST_DEVICES)
              return yield* refuse(
                `${MOST_DEVICES} devices already run on this computer, each taking gigabytes of its memory. device_close yours when you’re done with it, or wait for another task’s to close.`,
              )
            const reached = platform === 'ios' ? yield* iosReach(here) : yield* androidReach(here)
            if (!reached.ready) return yield* refuse(reached.why)
            const model = modelOf(reached.models, asked)
            if (model === null)
              return yield* refuse(
                `No ${platformWord(platform)} device is like ${asked}. There are: ${reached.models.map((one) => one.name).join(', ')}.`,
              )
            const started = platform === 'ios' ? yield* startIos(here, owner, model) : yield* startAndroid(here, model)
            const device: Running = {
              owner,
              platform,
              model: model.name,
              startedAt: yield* Clock.currentTimeMillis,
              screen: [],
              ...started,
            }
            running.set(keyOf(owner, platform), device)
            return `${named(device)} is running beside you (${device.id}). Install your build with device_install, or open a link with device_open_url.`
          }),
        )

      const close = (here: DeviceHost, owner: string, platform?: DevicePlatform) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const closing = [...running.values()].filter(
              (one) => one.owner === owner && (platform === undefined || one.platform === platform),
            )
            for (const device of closing) {
              running.delete(keyOf(owner, device.platform))
              yield* device.stop
            }
            return closing
          }),
        )

      /** The device a call is about: the platform it names, else the only one running for its owner. */
      const deviceFor = (owner: string, input: Input) => {
        const asked = input.platform
        const mine = [...running.values()].filter((one) => one.owner === owner)
        if (asked === 'ios' || asked === 'android') {
          const found = mine.find((one) => one.platform === asked)
          return found === undefined
            ? refuse(`No ${platformWord(asked)} device runs beside you. Start one with device_open.`)
            : Effect.succeed(found)
        }
        if (mine.length === 0) return refuse('No device runs beside you. Start one with device_open.')
        if (mine.length > 1) return refuse('An iOS and an Android device run beside you: say which, with platform.')
        return Effect.succeed(mine[0] as Running)
      }

      const iosCant = (what: string) =>
        refuse(
          `${what} an iOS simulator needs a driver Althar doesn’t have yet. Take a device_screenshot to see it; to get somewhere in the app, open a link with device_open_url.`,
        )

      const screenshot = (here: DeviceHost, device: Running): Effect.Effect<ToolPicture, ToolRefused> =>
        Effect.gen(function* () {
          const png =
            device.platform === 'ios'
              ? yield* here
                  .picture((path) => xcrun('io', device.id, 'screenshot', '--type=png', path))
                  .pipe(Effect.mapError((why) => new ToolRefused({ message: `The simulator’s screen couldn’t be read: ${why}` })))
              : (yield* must(here, { ...adb(here, device.id, 'exec-out', 'screencap', '-p'), base64: true })).trim()
          const size = pngSizeOf(png)
          if (size === null) return yield* refuse('The device gave back something that isn’t a picture. Try again once it has started.')
          return { text: `${named(device)}, ${size.width}×${size.height}.`, image: { data: png, mimeType: 'image/png' } }
        })

      const snapshot = (here: DeviceHost, device: Running) =>
        Effect.gen(function* () {
          if (device.platform === 'ios') return yield* iosCant('Reading the screen of')
          const xml = dumpedXmlOf(yield* must(here, adb(here, device.id, 'exec-out', 'uiautomator', 'dump', '/dev/tty')))
          if (xml === null) return yield* refuse('The screen couldn’t be read: it may still be changing. Try again in a moment.')
          device.screen = screenOf(xml)
          return screenWords(device.screen)
        })

      const tap = (here: DeviceHost, device: Running, input: Input) =>
        Effect.gen(function* () {
          if (device.platform === 'ios') return yield* iosCant('Tapping')
          const ref =
            textIn(input, 'ref')
              ?.replace(/^\[?ref=/, '')
              .replace(/\]$/, '') ?? null
          const { x, y } = input
          const at =
            ref !== null
              ? device.screen.find((one) => one.ref === ref)?.center
              : typeof x === 'number' && typeof y === 'number'
                ? { x: Math.round(x), y: Math.round(y) }
                : undefined
          if (at === undefined)
            return yield* refuse(
              ref === null
                ? 'Say where: a ref from device_snapshot, such as n3, or x and y in the screen’s pixels.'
                : `${ref} isn’t on the screen as last read. Take device_snapshot again.`,
            )
          yield* must(here, adb(here, device.id, 'shell', 'input', 'tap', String(at.x), String(at.y)))
          device.screen = []
          return `Tapped (${at.x}, ${at.y})${ref === null ? '' : `, ${ref}`}. The screen has likely changed: take device_snapshot again before the next ref.`
        })

      const type = (here: DeviceHost, device: Running, input: Input) =>
        Effect.gen(function* () {
          if (device.platform === 'ios') return yield* iosCant('Typing into')
          const text = typeof input.text === 'string' ? input.text : ''
          if (text === '') return yield* refuse('Give the text to type.')
          const lines = text.split('\n')
          for (const [at, line] of lines.entries()) {
            if (line !== '') yield* must(here, adb(here, device.id, 'shell', 'input', 'text', adbTextOf(line)))
            if (at < lines.length - 1 || input.submit === true)
              yield* must(here, adb(here, device.id, 'shell', 'input', 'keyevent', ANDROID_KEYS.enter))
          }
          return `Typed ${text.length} characters${input.submit === true ? ', then Enter' : ''}, into what has the focus.`
        })

      const press = (here: DeviceHost, device: Running, input: Input) =>
        Effect.gen(function* () {
          if (device.platform === 'ios') return yield* iosCant('Pressing keys on')
          const key = textIn(input, 'key')?.toLowerCase()
          if (key === undefined || !(key in ANDROID_KEYS)) return yield* refuse(`Say which key: ${Object.keys(ANDROID_KEYS).join(', ')}.`)
          yield* must(here, adb(here, device.id, 'shell', 'input', 'keyevent', ANDROID_KEYS[key as DeviceKey]))
          return `Pressed ${key}.`
        })

      const install = (here: DeviceHost, device: Running, input: Input) =>
        Effect.gen(function* () {
          const path = textIn(input, 'path')
          if (path === null || !(path.startsWith('/') || /^[A-Za-z]:\\/.test(path)))
            return yield* refuse(
              device.platform === 'ios'
                ? 'Give the path of the .app your build made, from /.'
                : 'Give the path of the .apk your build made, from /.',
            )
          if (device.platform === 'ios') yield* must(here, xcrun('install', device.id, path))
          else yield* must(here, adb(here, device.id, 'install', '-r', '-t', path))
          return `Installed ${path.split(/[\\/]/).at(-1)} on ${named(device)}. Open it with device_launch.`
        })

      const launch = (here: DeviceHost, device: Running, input: Input) =>
        Effect.gen(function* () {
          const app = textIn(input, 'app')
          if (app === null || !/^[A-Za-z][\w-]*(\.[\w-]+)+$/.test(app))
            return yield* refuse('Give the app’s bundle identifier or package name, such as ai.althar.mobile.')
          if (device.platform === 'ios') yield* must(here, xcrun('launch', '--terminate-running-process', device.id, app))
          else yield* must(here, adb(here, device.id, 'shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1'))
          return `Opened ${app} on ${named(device)}.`
        })

      const openUrl = (here: DeviceHost, device: Running, input: Input) =>
        Effect.gen(function* () {
          const url = textIn(input, 'url')
          if (url === null || !/^[a-z][a-z0-9+.-]*:\S+$/i.test(url))
            return yield* refuse('Give a link: a web address, the app’s own (myapp://settings) or the dev server’s (exp://localhost:8081).')
          if (device.platform === 'ios') yield* must(here, xcrun('openurl', device.id, url))
          else
            yield* must(
              here,
              adb(here, device.id, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${url.replaceAll("'", "'\\''")}'`),
            )
          return `Opened ${url} on ${named(device)}.`
        })

      const logs = (here: DeviceHost, device: Running, input: Input) =>
        Effect.gen(function* () {
          const app = textIn(input, 'app')
          if (device.platform === 'ios') {
            const predicate =
              app === null
                ? []
                : [
                    '--predicate',
                    `subsystem BEGINSWITH "${app.replaceAll('"', '')}" OR process == "${app.split('.').at(-1)?.replaceAll('"', '')}"`,
                  ]
            const printed = yield* must(here, xcrun('spawn', device.id, 'log', 'show', '--last', '2m', '--style', 'compact', ...predicate))
            return lastLines(printed)
          }
          const pid =
            app === null ? '' : ((yield* here.run(adb(here, device.id, 'shell', 'pidof', app))).stdout.trim().split(/\s+/)[0] ?? '')
          if (app !== null && pid === '')
            return `${app} isn’t running on ${named(device)}, so it has no log to read. Open it with device_launch.`
          return lastLines(
            yield* must(here, adb(here, device.id, 'logcat', '-d', '-t', String(MOST_LINES), ...(pid === '' ? [] : [`--pid=${pid}`]))),
          )
        })

      const lastLines = (printed: string) => {
        const lines = printed.trimEnd().split('\n')
        const kept = lines.slice(-MOST_LINES)
        return kept.length === 0 || (kept.length === 1 && kept[0] === '')
          ? 'Nothing was logged.'
          : `${lines.length > kept.length ? `(${lines.length - kept.length} earlier lines left out)\n` : ''}${kept.join('\n')}`
      }

      const state = (here: DeviceHost, owner: string) =>
        Effect.gen(function* () {
          const reached = yield* reach(here)
          const mine = [...running.values()].filter((one) => one.owner === owner)
          const lines = [
            mine.length === 0
              ? 'No device runs beside you.'
              : mine.map((one) => `Running beside you: ${named(one)} (${one.platform}, ${one.id}).`).join('\n'),
            ...reached.map((one) =>
              one.ready
                ? `${platformWord(one.platform)}: ${one.models.map((model) => `${model.name}${model.os === null ? '' : ` (${model.os})`}`).join(', ')}.`
                : `${platformWord(one.platform)}: can’t run here. ${one.why}`,
            ),
            `${running.size} of ${MOST_DEVICES} devices run on this computer.`,
          ]
          return lines.join('\n')
        })

      type Call = (here: DeviceHost, owner: string, input: Input, access: ToolAccess) => Effect.Effect<string | ToolPicture, ToolRefused>
      const on =
        (act: (here: DeviceHost, device: Running, input: Input) => Effect.Effect<string | ToolPicture, ToolRefused>): Call =>
        (here, owner, input) =>
          Effect.flatMap(deviceFor(owner, input), (device) => act(here, device, input))

      const PLATFORM = {
        platform: { type: 'string', enum: ['ios', 'android'], description: 'Which of your devices, where both run.' },
      } as const
      const definitions: ReadonlyArray<{
        readonly name: string
        readonly description: string
        readonly properties: Input
        readonly required?: ReadonlyArray<string>
        readonly call: Call
      }> = [
        {
          name: 'device_state',
          description:
            'Says which devices run beside you, and what this computer can run: the iOS simulators and Android virtual devices to start one from, or why a platform can’t run here (no Mac, no Xcode, no Android SDK, no acceleration). Opens nothing.',
          properties: {},
          call: (here, owner) => state(here, owner),
        },
        {
          name: 'device_open',
          description: `Starts a device of your own beside you and waits until it has started (up to three minutes): an iOS simulator made for you from the model you name, or an Android virtual device, run read-only so it is left as it was. It is yours alone, never the person’s own simulator, and it goes when your task is done. At most ${MOST_DEVICES} run on this computer at once; device_close yours when you’re done with it.`,
          properties: {
            platform: { type: 'string', enum: ['ios', 'android'] },
            model: {
              type: 'string',
              description: 'A model device_state lists, such as iPhone 16 or Pixel_8_API_35. The first listed without it.',
            },
          },
          required: ['platform'],
          call: (here, owner, input) =>
            input.platform === 'ios' || input.platform === 'android'
              ? open(here, owner, input.platform, textIn(input, 'model'))
              : refuse('Say which platform: ios or android.'),
        },
        {
          name: 'device_install',
          description:
            'Installs your build on your device: the .app a simulator build made (in DerivedData, or ios/build), or the .apk (app/build/outputs/apk). Build it first; this doesn’t build.',
          properties: { ...PLATFORM, path: { type: 'string' } },
          required: ['path'],
          call: on(install),
        },
        {
          name: 'device_launch',
          description: 'Opens an installed app on your device, from the start, by its bundle identifier (iOS) or package name (Android).',
          properties: { ...PLATFORM, app: { type: 'string' } },
          required: ['app'],
          call: on(launch),
        },
        {
          name: 'device_open_url',
          description:
            'Opens a link on your device: a web page, the app’s own link to a screen (myapp://settings), or a dev server’s (exp://localhost:8081, for Expo). The way to reach a screen of an iOS app, which can’t be tapped yet.',
          properties: { ...PLATFORM, url: { type: 'string' } },
          required: ['url'],
          call: on(openUrl),
        },
        {
          name: 'device_screenshot',
          description:
            'Takes a screenshot of your device’s screen, at its own pixels, and gives it back to you as a picture. An iOS simulator’s status bar always says 9:41, full bars, charged, so screenshots compare. Each picture stays in your context, so take only what you need to see.',
          properties: PLATFORM,
          call: on((here, device) => screenshot(here, device)),
        },
        {
          name: 'device_snapshot',
          description:
            'Reads an Android device’s screen as elements: each with a reference like [ref=n3], its kind, its words, its id and its centre, and whether it takes a tap. Cheaper than a screenshot. Take it again after the screen changes. Not for iOS yet.',
          properties: PLATFORM,
          call: on((here, device) => snapshot(here, device)),
        },
        {
          name: 'device_tap',
          description:
            'Taps an Android device’s screen: an element by its ref from device_snapshot, or x and y in the screen’s pixels. Not for iOS yet.',
          properties: { ...PLATFORM, ref: { type: 'string' }, x: { type: 'integer' }, y: { type: 'integer' } },
          call: on(tap),
        },
        {
          name: 'device_type',
          description:
            'Types text into what has the focus on an Android device: tap a field first. A new line presses Enter; submit presses Enter after. Not for iOS yet.',
          properties: { ...PLATFORM, text: { type: 'string' }, submit: { type: 'boolean' } },
          required: ['text'],
          call: on(type),
        },
        {
          name: 'device_press',
          description: `Presses a key on an Android device: ${Object.keys(ANDROID_KEYS).join(', ')}. Not for iOS yet.`,
          properties: { ...PLATFORM, key: { type: 'string', enum: Object.keys(ANDROID_KEYS) } },
          required: ['key'],
          call: on(press),
        },
        {
          name: 'device_logs',
          description: `Reads your device’s log, its last ${MOST_LINES} lines: an app’s alone where you name it (its bundle identifier or package name), else everything of the last two minutes.`,
          properties: { ...PLATFORM, app: { type: 'string' } },
          call: on(logs),
        },
        {
          name: 'device_close',
          description: 'Shuts down your device and deletes it, with what was installed on it. It goes by itself when your task is done.',
          properties: PLATFORM,
          call: (here, owner, input) =>
            Effect.map(
              close(here, owner, input.platform === 'ios' || input.platform === 'android' ? input.platform : undefined),
              (closed) => (closed.length === 0 ? 'No device ran beside you.' : `Closed ${closed.map(named).join(' and ')}.`),
            ),
        },
      ]

      const tools: ReadonlyArray<Tool> = definitions.map((one) => ({
        name: one.name,
        description: one.description,
        input: { type: 'object', properties: one.properties, ...(one.required === undefined ? {} : { required: one.required }) },
        call: (input, access) =>
          Effect.gen(function* () {
            const owner = pageOwnerOf(access)
            if (owner === null) return yield* refuse('Only a task’s lead and the project’s coordinator have devices.')
            if (host === undefined) return yield* refuse('This Althar can’t run simulators: only the desktop app does.')
            return yield* one.call(host, owner, recordOf(input), access)
          }),
      }))
      yield* toolServer.serve(POOL, tools)

      if (host !== undefined) {
        // A task done or abandoned, or a project removed, takes its devices with it.
        yield* Effect.forkScoped(
          Stream.runForEach(settling, (over) => Effect.forEach(over, (owner) => close(host, owner), { discard: true })).pipe(
            Effect.provideContext(context),
            Effect.catchCause((cause) => Effect.logWarning('Could not close the devices of a settled task', cause)),
          ),
        )
        // Althar quitting closes every device it started: none outlives it, as runs don't.
        yield* Effect.addFinalizer(() =>
          Effect.forEach([...new Set([...running.values()].map((one) => one.owner))], (owner) => close(host, owner), { discard: true }),
        )
      }

      return Devices.of({
        reach: () => (host === undefined ? Effect.succeed([]) : reach(host)),
        of: (owner) => Effect.sync(() => [...running.values()].filter((one) => one.owner === owner)),
        show: (owner, platform) =>
          Effect.gen(function* () {
            const device = running.get(keyOf(owner, platform))
            if (host === undefined || device === undefined || device.platform !== 'ios') return false
            const done = yield* host.run({ command: 'open', args: ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', device.id] })
            return done.code === 0
          }),
        close: (owner) => (host === undefined ? Effect.void : Effect.asVoid(close(host, owner))),
      })
    }),
  )
}
