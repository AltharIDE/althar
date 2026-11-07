// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { DEFAULT_PREFERENCES, holds } from '../src/main/appPreferences'
import { isLocalHost, refusalOf, shownAddress, signInOf, typedAddress } from '../src/main/browser/addresses'
import { clearsAt, COOKIE_KEEPS, isCookieKeep, type Moment, ownerOf, ownerOfFolder, partitionOf } from '../src/main/browser/cookies'
import { browserAgent, DEVICES, deviceOf, isViewport, mobileAgent, placed, WELL } from '../src/main/browser/devices'
import { allowed, askedOf, blockedFile, downloadOffered, navigation, popUp } from '../src/main/browser/guards'
import { pinsOf, rectOf } from '../src/main/browser/ipc'
import { cropOf, pickedOf, scaled } from '../src/main/browser/picked'

/* The rules a page beside the conversation follows (ADR-099), each on its own. */

const TASK = `task_${'a1'.repeat(16)}`
const PROJECT = `proj_${'b2'.repeat(16)}`

describe('what loads beside the conversation', () => {
  it('loads web pages, on http and https alone', () => {
    expect(refusalOf('https://althar.ai/changelog')).toBeNull()
    expect(refusalOf('http://localhost:5321/')).toBeNull()
    expect(navigation('http://127.0.0.1:8080/a?b#c')).toEqual({ kind: 'go' })
  })

  it('refuses files, scripts, data, blobs and every other scheme at the top, the page staying where it was', () => {
    expect(refusalOf('file:///Users/someone/.ssh/id_ed25519')).toBe('file')
    expect(navigation('file:///etc/passwd')).toEqual({ kind: 'refuse', refusal: 'file' })
    for (const address of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://althar.ai/1234',
      'about:blank',
      'chrome://settings',
      'devtools://devtools/bundled/inspector.html',
      'althar-picture://shot/' + '0'.repeat(64),
      'vscode://file/etc/passwd',
      'mailto:someone@example.com',
      'ftp://example.com/file',
    ])
      expect(navigation(address), address).toEqual({ kind: 'refuse', refusal: 'scheme' })
    expect(refusalOf('not a url')).toBe('address')
  })

  it('lets a frame inside a page hold the page’s own blank, inline, data and blob documents, never a file or another scheme', () => {
    for (const address of ['about:blank', 'about:srcdoc', 'data:text/html,hi', 'blob:https://althar.ai/1'])
      expect(navigation(address, 'frame'), address).toEqual({ kind: 'go' })
    expect(navigation('file:///etc/hosts', 'frame')).toEqual({ kind: 'refuse', refusal: 'file' })
    expect(navigation('javascript:alert(1)', 'frame')).toEqual({ kind: 'refuse', refusal: 'scheme' })
    expect(navigation('vscode://x', 'frame')).toEqual({ kind: 'refuse', refusal: 'scheme' })
  })

  it('opens a pop-up’s web page in the same view, and refuses one that isn’t a web page', () => {
    expect(popUp('https://althar.ai/docs')).toEqual({ kind: 'go' })
    expect(popUp('javascript:void(0)')).toEqual({ kind: 'refuse', refusal: 'scheme' })
    expect(popUp('file:///tmp/x')).toEqual({ kind: 'refuse', refusal: 'file' })
  })

  it('reads a typed address as a web page’s: http for this computer, https for anywhere else', () => {
    expect(typedAddress('localhost:5321')).toBe('http://localhost:5321/')
    expect(typedAddress('localhost:5321/settings?x=1')).toBe('http://localhost:5321/settings?x=1')
    expect(typedAddress('127.0.0.1:8080')).toBe('http://127.0.0.1:8080/')
    expect(typedAddress('app.localhost')).toBe('http://app.localhost/')
    expect(typedAddress('[::1]:3000')).toBe('http://[::1]:3000/')
    expect(typedAddress('althar.ai/changelog')).toBe('https://althar.ai/changelog')
    expect(typedAddress('  https://althar.ai  ')).toBe('https://althar.ai/')
    expect(typedAddress('http://example.com')).toBe('http://example.com/')
    // A scheme typed stays the scheme typed, to be refused after.
    expect(typedAddress('javascript:alert(1)')).toBe('javascript:alert(1)')
    expect(typedAddress('file:///etc/passwd')).toBe('file:///etc/passwd')
    expect(typedAddress('')).toBeNull()
    expect(typedAddress('how do i center a div')).toBeNull()
    expect(typedAddress('intranet')).toBeNull()
  })

  it('knows this computer’s hosts', () => {
    for (const host of ['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '0.0.0.0', '[::1]'])
      expect(isLocalHost(host), host).toBe(true)
    for (const host of ['localhost.example.com', '10.0.0.1', 'althar.ai']) expect(isLocalHost(host), host).toBe(false)
  })

  it('shows an address without its scheme where it goes without saying', () => {
    expect(shownAddress('http://localhost:5321/')).toBe('localhost:5321')
    expect(shownAddress('https://althar.ai/changelog?x=1#y')).toBe('althar.ai/changelog?x=1#y')
    expect(shownAddress('http://example.com/a')).toBe('http://example.com/a')
  })
})

describe('sign-ins that stay in the person’s browser', () => {
  it('finds Claude’s, GitHub’s, GitLab’s and Linear’s sign-in, sign-up and app-granting pages', () => {
    expect(signInOf('https://claude.ai/login?returnTo=%2Fnew')).toBe('Claude')
    expect(signInOf('https://claude.ai/oauth/authorize?client_id=x')).toBe('Claude')
    expect(signInOf('https://console.anthropic.com/login')).toBe('Claude')
    expect(signInOf('https://platform.claude.com/login')).toBe('Claude')
    expect(signInOf('https://github.com/login?return_to=%2Fsettings')).toBe('GitHub')
    expect(signInOf('https://github.com/login/oauth/authorize?client_id=x')).toBe('GitHub')
    expect(signInOf('https://github.com/session')).toBe('GitHub')
    expect(signInOf('https://www.github.com/login')).toBe('GitHub')
    expect(signInOf('https://gitlab.com/users/sign_in')).toBe('GitLab')
    expect(signInOf('https://gitlab.com/oauth/authorize?client_id=x')).toBe('GitLab')
    expect(signInOf('https://linear.app/login')).toBe('Linear')
    expect(signInOf('https://linear.app/oauth/authorize?client_id=x')).toBe('Linear')
    expect(navigation('https://linear.app/login')).toEqual({ kind: 'sign-in', service: 'Linear' })
  })

  it('leaves their other pages, and look-alikes elsewhere, to load', () => {
    expect(signInOf('https://github.com/AltharIDE/althar/pull/644')).toBeNull()
    expect(signInOf('https://github.com/loginator/repo')).toBeNull()
    expect(signInOf('https://gitlab.com/gitlab-org/gitlab/-/issues/1')).toBeNull()
    expect(signInOf('https://linear.app/althar/issue/DEV-83')).toBeNull()
    expect(signInOf('https://claude.ai/new')).toBeNull()
    expect(signInOf('https://github.com.evil.example/login')).toBeNull()
    expect(signInOf('https://evilgithub.com/login')).toBeNull()
    expect(signInOf('http://localhost:5321/login')).toBeNull()
    expect(signInOf('javascript:github.com/login')).toBeNull()
  })

  it('leaves a sign-in inside a frame of a page to the page', () => {
    expect(navigation('https://github.com/login', 'frame')).toEqual({ kind: 'go' })
  })
})

describe('what a page may ask for', () => {
  it('gets writing what the person copies, and nothing else', () => {
    expect(allowed('clipboard-sanitized-write')).toBe(true)
    for (const permission of [
      'media',
      'geolocation',
      'notifications',
      'clipboard-read',
      'midi',
      'midiSysex',
      'pointerLock',
      'fullscreen',
      'openExternal',
      'display-capture',
      'mediaKeySystem',
      'window-management',
      'idle-detection',
      'hid',
      'serial',
      'usb',
      'storage-access',
      'top-level-storage-access',
      'keyboardLock',
      'fileSystem',
      'unknown',
      'something-chromium-adds-later',
    ])
      expect(allowed(permission), permission).toBe(false)
  })

  it('says what a refused request asked for where the person would notice it', () => {
    expect(askedOf('media', ['video'])).toBe('camera')
    expect(askedOf('media', ['audio'])).toBe('microphone')
    expect(askedOf('media', ['video', 'audio'])).toBe('camera and microphone')
    expect(askedOf('media', [])).toBeNull()
    expect(askedOf('geolocation')).toBe('location')
    expect(askedOf('notifications')).toBe('notifications')
    expect(askedOf('clipboard-read')).toBe('clipboard')
    expect(askedOf('midiSysex')).toBe('MIDI devices')
    expect(askedOf('display-capture')).toBe('screen')
    expect(askedOf('fullscreen')).toBeNull()
  })

  it('hears a file link Chromium blocked in the page, which never became a navigation', () => {
    expect(blockedFile('error', 'Not allowed to load local resource: file:///etc/hosts')).toBe(true)
    expect(blockedFile('warning', 'Not allowed to load local resource: file:///etc/hosts')).toBe(false)
    expect(blockedFile('error', 'Uncaught TypeError: x is undefined')).toBe(false)
  })

  it('keeps no download, and offers the person’s browser one with a web address', () => {
    expect(downloadOffered('https://althar.ai/Althar.dmg')).toBe('https://althar.ai/Althar.dmg')
    expect(downloadOffered('http://localhost:5321/report.csv')).toBe('http://localhost:5321/report.csv')
    expect(downloadOffered('blob:http://localhost:5321/1234')).toBeNull()
    expect(downloadOffered('data:text/csv,a,b')).toBeNull()
    expect(downloadOffered('file:///tmp/x')).toBeNull()
  })
})

describe('how long pages keep cookies', () => {
  const moments: ReadonlyArray<Moment> = ['closed', 'quit', 'started', 'settled']
  const at = (keep: (typeof COOKIE_KEEPS)[number]) => moments.filter((moment) => clearsAt(keep, moment))

  it('until the page closes: at every moment', () => expect(at('page')).toEqual(['closed', 'quit', 'started', 'settled']))
  it('until Althar quits: as it quits, as it starts after a quit cut short, and when the task is done', () =>
    expect(at('quit')).toEqual(['quit', 'started', 'settled']))
  it('until the task is done: when it is', () => expect(at('task')).toEqual(['settled']))
  it('as long as each site asks: never', () => expect(at('site')).toEqual([]))

  it('keeps them until the task is done unless the person says otherwise, and opens thread links beside the conversation', () => {
    expect(DEFAULT_PREFERENCES.browserCookies).toBe('task')
    expect(DEFAULT_PREFERENCES.browserLinks).toBe('beside')
    expect(holds('browserCookies', 'quit')).toBe(true)
    expect(holds('browserCookies', 'forever')).toBe(false)
    expect(holds('browserLinks', 'outside')).toBe(true)
    expect(holds('browserLinks', 'tab')).toBe(false)
    expect(isCookieKeep('site')).toBe(true)
    expect(isCookieKeep(null)).toBe(false)
  })

  it('keeps each task’s and project’s pages in a persistent partition of their own, read back from its folder', () => {
    const task = ownerOf(TASK)
    const project = ownerOf(PROJECT)
    expect(task).toEqual({ kind: 'task', id: TASK })
    expect(partitionOf(task!)).toBe(`persist:task-${'a1'.repeat(16)}`)
    expect(partitionOf(project!)).toBe(`persist:project-${'b2'.repeat(16)}`)
    expect(ownerOfFolder(`task-${'a1'.repeat(16)}`)).toEqual(task)
    expect(ownerOfFolder(`project-${'b2'.repeat(16)}`)).toEqual(project)
    expect(ownerOfFolder('althar-screenshots')).toBeNull()
    expect(ownerOf('thr_abc')).toBeNull()
    expect(ownerOf(`task_${'A1'.repeat(16)}`)).toBeNull()
    expect(ownerOf('../task_x')).toBeNull()
  })
})

describe('the size a page is drawn at', () => {
  const panel = { x: 600, y: 100, width: 640, height: 700 }

  it('fills the panel at its own size', () => expect(placed(panel, 'fit')).toEqual({ rect: panel, scale: 1 }))

  it('lays a device’s page out at its size and draws it whole, scaled to fit the panel’s well, centred across', () => {
    const { rect, scale } = placed(panel, 'desktop')
    expect(scale).toBeCloseTo((640 - WELL * 2) / 1440)
    expect(rect.width).toBe(Math.round(1440 * scale))
    expect(rect.height).toBe(Math.round(900 * scale))
    expect(rect.x).toBe(600 + Math.round((640 - rect.width) / 2))
    expect(rect.y).toBe(100 + WELL)
  })

  it('draws a phone at its own size where it fits, and smaller where the panel is shorter', () => {
    expect(placed({ x: 0, y: 0, width: 640, height: 1000 }, 'phone').scale).toBe(1)
    const short = placed({ x: 0, y: 0, width: 640, height: 600 }, 'phone')
    expect(short.scale).toBeCloseTo((600 - WELL * 2) / 844)
    expect(short.rect.height).toBe(600 - WELL * 2)
  })

  it('knows the devices: desktop and laptop are computers, tablet and phone touch screens', () => {
    expect(DEVICES).toEqual({
      desktop: { width: 1440, height: 900, mobile: false },
      laptop: { width: 1280, height: 800, mobile: false },
      tablet: { width: 820, height: 1180, mobile: true },
      phone: { width: 390, height: 844, mobile: true },
    })
    expect(deviceOf('fit')).toBeNull()
    expect(isViewport('phone')).toBe(true)
    expect(isViewport('watch')).toBe(false)
  })

  it('tells sites a phone’s and a tablet’s browser on the Chromium that draws them, and Chrome’s own agent on a computer', () => {
    expect(mobileAgent('140.0.7339.0', DEVICES.phone)).toBe(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.0 Mobile Safari/537.36',
    )
    expect(mobileAgent('140.0.7339.0', DEVICES.tablet)).not.toContain('Mobile')
    expect(
      browserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) althar/0.7.0 Chrome/140.0.7339.0 Electron/44.10.0 Safari/537.36',
      ),
    ).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.0 Safari/537.36')
  })
})

describe('an element pointed at, as the page says it', () => {
  const said = {
    selector: 'section > span.needs',
    label: 'span.needs',
    text: 'Ubuntu 20.04, Fedora 38 or later',
    rect: { x: 10.4, y: 20.6, width: 282, height: 16 },
    font: '12px · 400 · Inter Variable',
    colour: '#8f887e',
    background: '#0a0a0a',
    page: { width: 639, height: 621 },
  }

  it('is taken whole, its numbers rounded', () =>
    expect(pickedOf(said)).toEqual({ ...said, rect: { x: 10, y: 21, width: 282, height: 16 } }))

  it('is refused where any part isn’t what it should be', () => {
    expect(pickedOf(null)).toBeNull()
    expect(pickedOf({ ...said, selector: '' })).toBeNull()
    expect(pickedOf({ ...said, selector: 'x'.repeat(4_001) })).toBeNull()
    expect(pickedOf({ ...said, text: 'x'.repeat(301) })).toBeNull()
    expect(pickedOf({ ...said, label: 42 })).toBeNull()
    expect(pickedOf({ ...said, colour: 'red\u0000' })).toBeNull()
    expect(pickedOf({ ...said, rect: { ...said.rect, width: Number.NaN } })).toBeNull()
    expect(pickedOf({ ...said, rect: { ...said.rect, height: -1 } })).toBeNull()
    expect(pickedOf({ ...said, page: { width: 0, height: 621 } })).toBeNull()
    expect(pickedOf({ ...said, page: 'big' })).toBeNull()
  })

  it('is cropped with a margin, kept to what shows of the page, and cut at its top where it is tall', () => {
    expect(cropOf({ x: 100, y: 100, width: 50, height: 20 }, { width: 600, height: 400 })).toEqual({ x: 88, y: 88, width: 74, height: 44 })
    expect(cropOf({ x: -40, y: 5, width: 700, height: 30 }, { width: 600, height: 400 })).toEqual({ x: 0, y: 0, width: 600, height: 47 })
    expect(cropOf({ x: 0, y: 0, width: 600, height: 4000 }, { width: 600, height: 5000 })).toEqual({ x: 0, y: 0, width: 600, height: 640 })
    expect(cropOf({ x: 0, y: 900, width: 50, height: 20 }, { width: 600, height: 400 })).toBeNull()
  })

  it('is found in the view’s pixels where the page is drawn smaller, whole pixels round it', () =>
    expect(scaled({ x: 10, y: 10, width: 101, height: 33 }, 0.5)).toEqual({ x: 5, y: 5, width: 51, height: 17 }))
})

describe('what the window sends about pages', () => {
  it('takes a place in the window only with every side a number', () => {
    expect(rectOf({ x: 600, y: 88, width: 640, height: 700 })).toEqual({ x: 600, y: 88, width: 640, height: 700 })
    expect(rectOf({ x: 600, y: 88, width: -1, height: 700 })).toBeNull()
    expect(rectOf({ x: '600', y: 88, width: 1, height: 700 })).toBeNull()
    expect(rectOf({ x: Infinity, y: 88, width: 1, height: 700 })).toBeNull()
    expect(rectOf(null)).toBeNull()
  })

  it('takes pins only whole, at most a hundred', () => {
    const pin = { n: 1, selector: 'main > h1', address: 'http://localhost:5321/' }
    expect(pinsOf([pin])).toEqual([pin])
    expect(pinsOf([{ ...pin, n: 0 }])).toBeNull()
    expect(pinsOf([{ ...pin, n: 1.5 }])).toBeNull()
    expect(pinsOf([{ ...pin, selector: '' }])).toBeNull()
    expect(pinsOf([{ ...pin, address: 7 }])).toBeNull()
    expect(pinsOf(Array.from({ length: 101 }, (_, i) => ({ ...pin, n: i + 1 })))).toBeNull()
    expect(pinsOf('pins')).toBeNull()
  })
})
