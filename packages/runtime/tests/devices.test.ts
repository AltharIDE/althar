import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Coordinator } from '../src/Coordinator'
import type { DeviceCommand, DeviceHost, DeviceRan } from '../src/deviceHost'
import { MOST_DEVICES } from '../src/Devices'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, callToolWhole, listTools, repository, runtime } from './support'

/*
 * A simulator or an emulator of its own beside each task (Devices.ts): its
 * lead starts it, installs on it, drives it and screenshots it, and it goes
 * with the task. The computer here is a fake that answers as simctl, the
 * emulator and adb do, keeping every command it was given.
 */

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'devices', name), 'utf8')

/** A PNG of one pixel, as a screenshot comes back. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

interface Computer {
  readonly platform?: NodeJS.Platform
  readonly xcode?: boolean
  readonly sdk?: boolean
  readonly kvm?: boolean
  /** simctl's list of every simulator, Althar's leftovers among them. */
  readonly simulators?: string
}

/** A computer with Xcode and the Android SDK unless it says, and what it was asked, a line a command. */
const computer = (given: Computer = {}) => {
  const ran: Array<string> = []
  const started: Array<string> = []
  const stopped: Array<string> = []
  let made = 0
  const ok = (stdout = ''): DeviceRan => ({ code: 0, stdout, stderr: '', missing: false })
  const missing: DeviceRan = { code: null, stdout: '', stderr: 'spawn ENOENT', missing: true }
  const lineOf = (command: DeviceCommand) => [command.command, ...command.args].join(' ')
  const answer = (line: string): DeviceRan => {
    if (line.startsWith('xcrun ')) {
      if (given.xcode === false) return missing
      if (line.startsWith('xcrun simctl list devices')) return ok(given.simulators ?? fixture('simctl-list.json'))
      if (line.startsWith('xcrun simctl create')) return ok(`NEW-${(made += 1)}\n`)
      return ok()
    }
    if (line.startsWith('/sdk/emulator/emulator')) {
      if (given.sdk === false) return missing
      if (line.endsWith('-list-avds')) return ok('Pixel_8_API_35\n')
      if (line.endsWith('-accel-check'))
        return given.kvm === false
          ? { ...ok('accel:\n7\n/dev/kvm is not found\naccel'), code: 1 }
          : ok('accel:\n0\nKVM (version 12) is installed and usable.\naccel')
    }
    if (line.startsWith('/sdk/platform-tools/adb')) {
      if (line.endsWith('devices -l')) return ok(fixture('adb-devices.txt'))
      if (line.endsWith('getprop sys.boot_completed')) return ok('1\n')
      if (line.endsWith('getprop ro.build.version.release')) return ok('15\n')
      if (line.endsWith('uiautomator dump /dev/tty')) return ok(fixture('uiautomator.xml'))
      if (line.endsWith('screencap -p')) return ok(PIXEL)
      if (line.includes('pidof')) return ok('4242\n')
      if (line.includes('logcat')) return ok('11-18 15:00:01.000  4242  4242 I ReactNativeJS: Paired\n')
      return ok()
    }
    return ok()
  }
  const host: DeviceHost = {
    platform: given.platform ?? 'darwin',
    env: { ANDROID_HOME: '/sdk' },
    home: '/Users/person',
    run: (command) =>
      Effect.sync(() => {
        const line = lineOf(command)
        ran.push(line)
        return answer(line)
      }),
    start: (command) =>
      Effect.sync(() => {
        const line = lineOf(command)
        started.push(line)
        return { stop: Effect.sync(() => void stopped.push(line)) }
      }),
    picture: (command) =>
      Effect.sync(() => {
        ran.push(lineOf(command('/tmp/screen.png')))
        return PIXEL
      }),
  }
  return { host, ran, started, stopped }
}

/** A project with a task, its lead's access, and the coordinator's. */
const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const threadId = yield* (yield* Coordinator).thread(project.projectId)
  const task = (title: string) =>
    Effect.gen(function* () {
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title }),
        projectId: project.projectId,
        title,
        draft: true,
      })
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: created.threadId,
        sessionId: 'none',
        taskId: created.taskId,
      }
      return lead
    })
  const lead = yield* task('Pairing screen on phones')
  const other = yield* task('Board on tablets')
  const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
  return { project, lead, other, coordinator }
})

describe('a device beside a task', () => {
  it.live('is the lead’s and the coordinator’s, and says so where this Althar runs none', () =>
    Effect.gen(function* () {
      const { lead, coordinator } = yield* opened
      const listed = yield* listTools(lead)
      for (const name of ['device_state', 'device_open', 'device_screenshot', 'device_snapshot', 'device_tap', 'device_close'])
        assert.include(listed, name)
      assert.include(yield* listTools(coordinator), 'device_open')
      const refused = yield* callToolWhole(lead, 'device_open', { platform: 'ios' })
      assert.isTrue(refused.isError)
      assert.deepStrictEqual(refused.content, [{ type: 'text', text: 'This Althar can’t run simulators: only the desktop app does.' }])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says what this computer can run, and how to fix what it can’t', () => {
    const linux = computer({ platform: 'linux', kvm: false })
    return Effect.gen(function* () {
      const { lead } = yield* opened
      assert.strictEqual(
        yield* callTool(lead, 'device_state', {}),
        [
          'No device runs beside you.',
          'iOS: can’t run here. iOS simulators run only on a Mac, with Xcode.',
          'Android: can’t run here. This computer has no KVM, which the Android emulator needs. A virtual machine or a container usually has none; on your own Linux, add yourself to the kvm group.',
          `0 of ${MOST_DEVICES} devices run on this computer.`,
        ].join('\n'),
      )
      assert.strictEqual(
        yield* callTool(lead, 'device_open', { platform: 'android' }),
        'This computer has no KVM, which the Android emulator needs. A virtual machine or a container usually has none; on your own Linux, add yourself to the kvm group.',
      )
      assert.deepStrictEqual(linux.started, [])
    }).pipe(Effect.provide(runtime(undefined, undefined, { devices: linux.host })))
  })

  it.live('makes an iOS simulator of the lead’s own, never touching the person’s, and screenshots it', () => {
    const mac = computer()
    return Effect.gen(function* () {
      const { lead } = yield* opened
      assert.match(
        yield* callTool(lead, 'device_state', {}),
        /iOS: iPhone 16 \(iOS 18\.2\), iPhone 15 \(iOS 17\.5\), iPad Air 11-inch \(M2\) \(iOS 18\.2\)\./,
      )
      assert.strictEqual(
        yield* callTool(lead, 'device_open', { platform: 'ios', model: 'iphone 16' }),
        'iPhone 16 · iOS 18.2 is running beside you (NEW-1). Install your build with device_install, or open a link with device_open_url.',
      )
      const created = mac.ran.filter((line) => line.startsWith('xcrun') && !line.includes(' list '))
      assert.deepStrictEqual(created, [
        `xcrun simctl create Althar · ${lead.taskId} com.apple.CoreSimulator.SimDeviceType.iPhone-16 com.apple.CoreSimulator.SimRuntime.iOS-18-2`,
        'xcrun simctl boot NEW-1',
        'xcrun simctl bootstatus NEW-1 -b',
        'xcrun simctl status_bar NEW-1 override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100',
      ])
      // The person's booted iPhone 16 is never named in a command.
      assert.isFalse(mac.ran.some((line) => line.includes('9F8E7D6C-5B4A-4392-8170-6F5E4D3C2B1A')))
      assert.match(yield* callTool(lead, 'device_open', { platform: 'ios' }), /is already running beside you/)

      assert.strictEqual(
        yield* callTool(lead, 'device_install', { path: '/w/ios/build/Althar.app' }),
        'Installed Althar.app on iPhone 16 · iOS 18.2. Open it with device_launch.',
      )
      assert.strictEqual(
        yield* callTool(lead, 'device_open_url', { url: 'althar://pair?code=abc' }),
        'Opened althar://pair?code=abc on iPhone 16 · iOS 18.2.',
      )
      const shot = yield* callToolWhole(lead, 'device_screenshot', {})
      assert.deepStrictEqual(shot.content, [
        { type: 'text', text: 'iPhone 16 · iOS 18.2, 1×1.' },
        { type: 'image', data: PIXEL, mimeType: 'image/png' },
      ])
      assert.include(mac.ran, 'xcrun simctl io NEW-1 screenshot --type=png /tmp/screen.png')
      assert.match(yield* callTool(lead, 'device_tap', { x: 10, y: 10 }), /needs a driver Althar doesn’t have yet/)

      assert.strictEqual(yield* callTool(lead, 'device_close', {}), 'Closed iPhone 16 · iOS 18.2.')
      assert.deepStrictEqual(mac.ran.slice(-2), ['xcrun simctl shutdown NEW-1', 'xcrun simctl delete NEW-1'])
      assert.strictEqual(yield* callTool(lead, 'device_screenshot', {}), 'No device runs beside you. Start one with device_open.')
    }).pipe(Effect.provide(runtime(undefined, undefined, { devices: mac.host })))
  })

  it.live('deletes the simulators a crash left the first time it makes one, and only Althar’s', () => {
    const listed = JSON.parse(fixture('simctl-list.json')) as { devices: Record<string, Array<Record<string, unknown>>> }
    listed.devices['com.apple.CoreSimulator.SimRuntime.iOS-18-2']?.push({
      udid: 'LEFT-1',
      isAvailable: true,
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
      state: 'Booted',
      name: 'Althar · task_0000',
    })
    const mac = computer({ simulators: JSON.stringify(listed) })
    return Effect.gen(function* () {
      const { lead } = yield* opened
      yield* callTool(lead, 'device_open', { platform: 'ios' })
      const changed = mac.ran.filter((line) => /simctl (shutdown|delete|create)/.test(line))
      assert.deepStrictEqual(changed.slice(0, 2), ['xcrun simctl shutdown LEFT-1', 'xcrun simctl delete LEFT-1'])
      assert.match(changed[2] ?? '', /^xcrun simctl create Althar · task_/)
    }).pipe(Effect.provide(runtime(undefined, undefined, { devices: mac.host })))
  })

  it.live('runs an Android device read-only on a port of its own, and drives it by what its screen says', () => {
    const mac = computer()
    return Effect.gen(function* () {
      const { lead } = yield* opened
      assert.strictEqual(
        yield* callTool(lead, 'device_open', { platform: 'android' }),
        'Pixel 8 API 35 · Android 15 is running beside you (emulator-5558). Install your build with device_install, or open a link with device_open_url.',
      )
      assert.deepStrictEqual(mac.started, [
        '/sdk/emulator/emulator -avd Pixel_8_API_35 -read-only -no-window -no-audio -no-boot-anim -no-snapshot-save -port 5558',
      ])
      assert.include(mac.ran, '/sdk/platform-tools/adb -s emulator-5558 wait-for-device')

      assert.strictEqual(
        yield* callTool(lead, 'device_tap', { ref: 'n4' }),
        'n4 isn’t on the screen as last read. Take device_snapshot again.',
      )
      const screen = yield* callTool(lead, 'device_snapshot', {})
      assert.include(screen, '[ref=n4] Button "Paste a code" #paste (540, 2048) tap')
      assert.match(yield* callTool(lead, 'device_tap', { ref: '[ref=n4]' }), /^Tapped \(540, 2048\), n4\./)
      assert.include(mac.ran, '/sdk/platform-tools/adb -s emulator-5558 shell input tap 540 2048')
      // A tap changes the screen, so its references are read again before the next.
      assert.match(yield* callTool(lead, 'device_tap', { ref: 'n4' }), /isn’t on the screen as last read/)

      assert.strictEqual(
        yield* callTool(lead, 'device_type', { text: 'abc def', submit: true }),
        'Typed 7 characters, then Enter, into what has the focus.',
      )
      assert.deepStrictEqual(mac.ran.slice(-2), [
        '/sdk/platform-tools/adb -s emulator-5558 shell input text abc%sdef',
        '/sdk/platform-tools/adb -s emulator-5558 shell input keyevent KEYCODE_ENTER',
      ])
      assert.strictEqual(yield* callTool(lead, 'device_press', { key: 'back' }), 'Pressed back.')
      assert.strictEqual(
        yield* callTool(lead, 'device_launch', { app: 'ai.althar.mobile' }),
        'Opened ai.althar.mobile on Pixel 8 API 35 · Android 15.',
      )
      assert.strictEqual(
        yield* callTool(lead, 'device_logs', { app: 'ai.althar.mobile' }),
        '11-18 15:00:01.000  4242  4242 I ReactNativeJS: Paired',
      )
      assert.include(mac.ran, '/sdk/platform-tools/adb -s emulator-5558 logcat -d -t 300 --pid=4242')
      const shot = yield* callToolWhole(lead, 'device_screenshot', {})
      assert.deepStrictEqual(shot.content[0], { type: 'text', text: 'Pixel 8 API 35 · Android 15, 1×1.' })
    }).pipe(Effect.provide(runtime(undefined, undefined, { devices: mac.host })))
  })

  it.live('asks which device where a lead runs both, and refuses one more than the computer runs at once', () => {
    const mac = computer()
    return Effect.gen(function* () {
      const { lead, other, coordinator } = yield* opened
      yield* callTool(lead, 'device_open', { platform: 'ios' })
      yield* callTool(lead, 'device_open', { platform: 'android' })
      assert.strictEqual(
        yield* callTool(lead, 'device_screenshot', {}),
        'An iOS and an Android device run beside you: say which, with platform.',
      )
      assert.strictEqual((yield* callToolWhole(lead, 'device_screenshot', { platform: 'android' })).isError, false)
      yield* callTool(other, 'device_open', { platform: 'android' })
      assert.match(
        yield* callTool(coordinator, 'device_open', { platform: 'ios' }),
        new RegExp(`^${MOST_DEVICES} devices already run on this computer`),
      )
      // The other task's emulator takes the next port.
      assert.match(mac.started[1] ?? '', /-port 5560$/)
    }).pipe(Effect.provide(runtime(undefined, undefined, { devices: mac.host })))
  })

  it.live('go with a removed project, and every device goes when Althar quits', () => {
    const mac = computer()
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const { project, lead, coordinator } = yield* opened
        yield* callTool(coordinator, 'device_open', { platform: 'ios' })
        yield* callTool(lead, 'device_open', { platform: 'android' })
        yield* (yield* Projects).remove(project.projectId)
        // The project's own device goes as it is removed, in the background.
        for (let tries = 0; tries < 100 && !mac.ran.includes('xcrun simctl delete NEW-1'); tries += 1) yield* Effect.sleep('20 millis')
        assert.include(mac.ran, 'xcrun simctl delete NEW-1')
      }).pipe(Effect.provide(runtime(undefined, undefined, { devices: mac.host })))
      // The task's emulator went with the runtime.
      assert.deepStrictEqual(mac.stopped, [
        '/sdk/emulator/emulator -avd Pixel_8_API_35 -read-only -no-window -no-audio -no-boot-anim -no-snapshot-save -port 5558',
      ])
      assert.include(mac.ran, '/sdk/platform-tools/adb -s emulator-5558 emu kill')
    })
  })
})
