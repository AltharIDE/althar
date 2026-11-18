import type { ThreadItem } from '@althar/contracts'

import { items } from '../../tests/fixtures'

/*
 * What the device lab shows: a task on the phone app whose lead checks its
 * work on an iPhone and a Pixel (Devices.ts's tools), and the devices
 * themselves. Made up, with no runtime; times count back from when the page
 * opened.
 */

export const LEAD = 'claude-code'
export const LEAD_MODEL = 'opus'
export const WORKTREE = '/Users/ada/code/althar-mobile'

const opened = Date.now()
/** A moment of the task, in minutes and seconds after it started, twelve minutes before the page opened. */
export const at = (minutes: number, seconds = 0) => new Date(opened - 12 * 60_000 + minutes * 60_000 + seconds * 1000).toISOString()

let sequence = 2_000
const placed = (item: ThreadItem, iso: string): ThreadItem => {
  sequence += 1
  return { ...item, id: `device${sequence}`, sequence, createdAt: iso }
}
const lead = { model: LEAD_MODEL }
const says = (text: string, when: string) => placed({ ...items.says(text, LEAD), ...lead }, when)
const call = (tool: string, when: string) => placed({ ...items.tool({ title: `Call ${tool}`, toolKind: 'other' }, LEAD), ...lead }, when)
const edit = (path: string, when: string) =>
  placed({ ...items.tool({ title: `Edit ${path}`, toolKind: 'edit', locations: [{ path: `${WORKTREE}/${path}` }] }, LEAD), ...lead }, when)
const run = (command: string, when: string) =>
  placed({ ...items.tool({ title: command, toolKind: 'execute', command, exit: 0, output: null }, LEAD), ...lead }, when)

export const REQUEST =
  'People don’t know where a pairing code comes from. Say it on the first screen, under the buttons, and check it on an iPhone and on Android.'

/** The task so far: the change made, the iPhone checked, the Pixel being checked. */
export const thread = (): ReadonlyArray<ThreadItem> => [
  says('I’ll add the line under the buttons, then look at it on an iPhone 16 and a Pixel 8.', at(0, 20)),
  edit('src/app/index.tsx', at(1, 2)),
  run('bun run check && bun run test', at(1, 40)),
  call('device_open', at(2, 10)),
  run('npx expo run:ios --device "Althar · Pairing code"', at(3, 0)),
  call('device_screenshot', at(6, 30)),
  says('On the iPhone the line sits under Scan a code, and opening it pushes the buttons up without covering them.', at(6, 52)),
  call('device_open', at(7, 20)),
  run('npx expo run:android --device emulator-5558', at(8, 0)),
  call('device_snapshot', at(10, 40)),
  call('device_tap', at(10, 48)),
]

export type Platform = 'ios' | 'android'

export interface Device {
  readonly id: string
  readonly platform: Platform
  readonly model: string
  readonly os: string
  /** Its screen, in points: what the app lays out at. */
  readonly width: number
  readonly height: number
}

export const IPHONE: Device = { id: 'NEW-1', platform: 'ios', model: 'iPhone 16', os: 'iOS 18.2', width: 393, height: 852 }
export const PIXEL: Device = { id: 'emulator-5558', platform: 'android', model: 'Pixel 8', os: 'Android 15', width: 412, height: 915 }

/** What this Mac can start, as device_state lists it. */
export const MODELS: ReadonlyArray<{ readonly name: string; readonly os: string; readonly platform: Platform }> = [
  { name: 'iPhone 16', os: 'iOS 18.2', platform: 'ios' },
  { name: 'iPhone 15', os: 'iOS 17.5', platform: 'ios' },
  { name: 'iPad Air 11-inch (M2)', os: 'iOS 18.2', platform: 'ios' },
  { name: 'Pixel 8', os: 'Android 15', platform: 'android' },
]

/** The app's screens the lab draws: the first, with where a code comes from open, and the home once paired. */
export type Screen = 'first' | 'where' | 'deck'

/** Screenshots the lead took, newest first: what D shows. */
export const SHOTS: ReadonlyArray<{ readonly device: Device; readonly screen: Screen; readonly at: string }> = [
  { device: PIXEL, screen: 'where', at: at(10, 52) },
  { device: PIXEL, screen: 'first', at: at(10, 30) },
  { device: IPHONE, screen: 'where', at: at(6, 40) },
  { device: IPHONE, screen: 'first', at: at(6, 30) },
]
