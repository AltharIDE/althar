import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'

import {
  accelerated,
  adbTextOf,
  androidSdkOf,
  attachedOf,
  avdsOf,
  dumpedXmlOf,
  freeEmulatorPort,
  iosModelsOf,
  iosRuntimeOf,
  pngSizeOf,
  screenOf,
  screenWords,
  simulatorNameFor,
  simulatorsOf,
} from '../src/deviceOutput'

/*
 * Simulators and emulators as their own tools print them: simctl's JSON,
 * adb's and the emulator's lists, a uiautomator dump. The fixtures are
 * output of the shape Xcode 16 and the Android SDK's platform tools 35 print.
 */

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'devices', name), 'utf8')

/** A PNG of one pixel. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('iOS simulators, from simctl', () => {
  it('reads a runtime’s key as the iOS it is, and no other platform’s', () => {
    assert.strictEqual(iosRuntimeOf('com.apple.CoreSimulator.SimRuntime.iOS-18-2'), 'iOS 18.2')
    assert.strictEqual(iosRuntimeOf('com.apple.CoreSimulator.SimRuntime.iOS-17'), 'iOS 17')
    assert.strictEqual(iosRuntimeOf('com.apple.CoreSimulator.SimRuntime.watchOS-11-2'), null)
    assert.strictEqual(iosRuntimeOf('com.apple.CoreSimulator.SimRuntime.xrOS-2-0'), null)
  })

  it('lists the available iOS simulators, newest iOS first, with what makes another of each', () => {
    const listed = simulatorsOf(fixture('simctl-list.json'))
    assert.deepStrictEqual(
      listed?.map((one) => `${one.name} · ${one.os} · ${one.state}`),
      ['iPad Air 11-inch (M2) · iOS 18.2 · Shutdown', 'iPhone 16 · iOS 18.2 · Booted', 'iPhone 15 · iOS 17.5 · Shutdown'],
    )
    assert.deepStrictEqual(
      listed?.find((one) => one.name === 'iPhone 16'),
      {
        udid: '9F8E7D6C-5B4A-4392-8170-6F5E4D3C2B1A',
        name: 'iPhone 16',
        os: 'iOS 18.2',
        state: 'Booted',
        type: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
        runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
      },
    )
  })

  it('says it read nothing where simctl printed no list', () => {
    assert.strictEqual(simulatorsOf('xcrun: error: unable to find utility "simctl"'), null)
    assert.strictEqual(simulatorsOf('{"runtimes":[]}'), null)
  })

  it('offers the person’s simulators to make one from, iPhones first, and never Althar’s own copies', () => {
    const listed = simulatorsOf(fixture('simctl-list.json')) ?? []
    const ours = { ...listed[0]!, udid: 'OURS', name: simulatorNameFor('task_1') }
    assert.deepStrictEqual(
      iosModelsOf([ours, ...listed]).map((one) => one.name),
      ['iPhone 16', 'iPhone 15', 'iPad Air 11-inch (M2)'],
    )
  })
})

describe('Android devices, from the emulator and adb', () => {
  it('lists AVDs, leaving out what the emulator says of itself', () => {
    assert.deepStrictEqual(avdsOf('INFO    | Storing crashdata in: /tmp/android/emu-crash.db\nPixel_8_API_35\nMedium_Phone_API_36\n'), [
      { id: 'Pixel_8_API_35', name: 'Pixel 8 API 35', os: null },
      { id: 'Medium_Phone_API_36', name: 'Medium Phone API 36', os: null },
    ])
  })

  it('reads what adb has attached, past its daemon starting', () => {
    assert.deepStrictEqual(attachedOf(fixture('adb-devices.txt')), [
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'emulator-5556', state: 'offline' },
      { serial: 'R5CT90XYZ12', state: 'unauthorized' },
    ])
  })

  it('takes the first even port no emulator has, its own or another’s', () => {
    const attached = attachedOf(fixture('adb-devices.txt'))
    assert.strictEqual(freeEmulatorPort(attached), 5558)
    assert.strictEqual(freeEmulatorPort(attached, [5558]), 5560)
    assert.strictEqual(freeEmulatorPort([]), 5554)
    const full = Array.from({ length: 64 }, (_, at) => 5554 + at * 2)
    assert.strictEqual(freeEmulatorPort([], full), null)
  })

  it('finds the SDK where it is named, else where Android Studio puts it', () => {
    assert.strictEqual(androidSdkOf({ ANDROID_HOME: '/opt/android' }, 'linux', '/home/p'), '/opt/android')
    assert.strictEqual(androidSdkOf({ ANDROID_SDK_ROOT: '/sdk' }, 'darwin', '/Users/p'), '/sdk')
    assert.strictEqual(androidSdkOf({}, 'darwin', '/Users/p'), '/Users/p/Library/Android/sdk')
    assert.strictEqual(androidSdkOf({}, 'linux', '/home/p'), '/home/p/Android/Sdk')
  })

  it('tells acceleration that works from acceleration that doesn’t', () => {
    assert.isTrue(accelerated(0, 'accel:\n0\nKVM (version 12) is installed and usable.\naccel'))
    assert.isTrue(accelerated(0, 'accel:\n0\nHypervisor.Framework OS X Version 15.1\nusable\naccel'))
    assert.isFalse(accelerated(1, 'accel:\n7\n/dev/kvm is not found: VT disabled in BIOS or KVM kernel module not loaded\naccel'))
    assert.isFalse(accelerated(0, 'WHPX is not installed.'))
  })

  it('reads a screen’s elements worth naming, in order, each with a reference and its centre', () => {
    const xml = dumpedXmlOf(fixture('uiautomator.xml'))
    assert.isNotNull(xml)
    const screen = screenOf(xml ?? '')
    assert.deepStrictEqual(
      screen.map((one) => [one.ref, one.role, one.words, one.id, one.center.x, one.center.y, one.tappable]),
      [
        ['n1', 'TextView', 'Pair with a home', 'title', 540, 366, false],
        ['n2', 'ViewGroup', 'Scan a code', '', 540, 1872, true],
        ['n3', 'TextView', 'Scan a code', '', 540, 1872, false],
        ['n4', 'Button', 'Paste a code', 'paste', 540, 2048, true],
        ['n5', 'TextView', 'Codes & homes "help"', '', 540, 2230, false],
      ],
    )
    assert.strictEqual(screenWords(screen).split('\n')[3], '[ref=n4] Button "Paste a code" #paste (540, 2048) tap')
    assert.match(screenWords([]), /Nothing on this screen/)
    assert.strictEqual(dumpedXmlOf('ERROR: could not get idle state.'), null)
  })

  it('types text so the device’s shell reads it as it was written', () => {
    assert.strictEqual(adbTextOf('hello world'), 'hello%sworld')
    assert.strictEqual(adbTextOf(`it's "$5" & more;`), `it\\'s%s\\"\\$5\\"%s\\&%smore\\;`)
  })
})

describe('screenshots', () => {
  it('reads a PNG’s size from its header, and nothing from what isn’t one', () => {
    assert.deepStrictEqual(pngSizeOf(PIXEL), { width: 1, height: 1 })
    assert.strictEqual(pngSizeOf(Buffer.from('error: no devices/emulators found').toString('base64')), null)
  })
})
