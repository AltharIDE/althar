import { expect, it } from 'vitest'

import { isSystemPrompt, keyChord, launchArguments } from '../src/computer/protocol'

it('reads keys as a lead gives them: one key, a chord, or a chord written as one', () => {
  expect(keyChord(['return'])).toEqual({ modifiers: [], key: 'return' })
  expect(keyChord(['Enter'])).toEqual({ modifiers: [], key: 'return' })
  expect(keyChord(['cmd', 'space'])).toEqual({ modifiers: ['cmd'], key: 'space' })
  expect(keyChord(['Command+Space'])).toEqual({ modifiers: ['cmd'], key: 'space' })
  expect(keyChord(['cmd', 'shift', 'Tab'])).toEqual({ modifiers: ['cmd', 'shift'], key: 'tab' })
  expect(keyChord(['alt', 'esc'])).toEqual({ modifiers: ['option'], key: 'escape' })
  // Two keys at once, or none, isn’t a chord: they go one call at a time.
  expect(keyChord(['a', 'b'])).toBeNull()
  expect(keyChord(['cmd'])).toBeNull()
})

it('launches an app with what each system’s driver takes', () => {
  const listed = { name: 'Akiflow', path: '/Applications/Akiflow.app', bundleId: 'com.akiflow.akiflow' }
  expect(launchArguments(listed, 'darwin')).toEqual({ bundle_id: 'com.akiflow.akiflow' })
  expect(launchArguments({ name: 'Akiflow', path: '/Applications/Akiflow.app' }, 'darwin')).toEqual({ name: '/Applications/Akiflow.app' })
  expect(launchArguments({ name: 'Akiflow' }, 'darwin')).toEqual({ name: 'Akiflow' })
  // Linux lists an XDG id as each app's bundle id, which its launch ignores: the path it listed opens it.
  const desktop = { name: 'Files', path: '/usr/share/applications/org.gnome.Nautilus.desktop', bundleId: 'org.gnome.Nautilus' }
  expect(launchArguments(desktop, 'linux')).toEqual({ launch_path: desktop.path })
  expect(launchArguments({ name: 'Files', bundleId: 'org.gnome.Nautilus' }, 'linux')).toEqual({ name: 'Files' })
  expect(launchArguments({ name: 'Notepad', path: 'C:\\Windows\\notepad.exe' }, 'win32')).toEqual({
    launch_path: 'C:\\Windows\\notepad.exe',
  })
  expect(launchArguments({ name: 'Calculator', bundleId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }, 'win32')).toEqual({
    bundle_id: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
  })
})

it('knows the system’s own security prompts, which stay the person’s', () => {
  expect(isSystemPrompt('universalAccessAuthWarn')).toBe(true)
  expect(isSystemPrompt('SecurityAgent')).toBe(true)
  expect(isSystemPrompt('Akiflow')).toBe(false)
})
