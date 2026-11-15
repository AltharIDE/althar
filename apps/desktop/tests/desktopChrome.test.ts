import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { watchPortalSetting } from '../src/main/colorScheme'
import { decideChrome } from '../src/main/desktop'
import {
  CHROME_CACHE,
  chromeOf,
  type ChromeSources,
  configCascade,
  followDesktopChrome,
  PROBES,
  systemSources,
} from '../src/main/desktopChrome'

/*
 * Every source here is a fixture: environments, file texts and what gdbus, xprop or gsettings would print. Nothing touches this computer's
 * own desktop, config or session bus, and the child_process the system's sources use is a fake that records what they would run.
 */

const spawned = vi.hoisted(() => [] as string[])
vi.mock('node:child_process', () => ({
  execFile: (command: string, _args: unknown, _options: unknown, done: (error: Error | null, out: string) => void) => {
    spawned.push(command)
    queueMicrotask(() => done(new Error('not here'), ''))
    return new EventEmitter()
  },
  spawn: (command: string) => {
    spawned.push(command)
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => true, unref: () => undefined })
    queueMicrotask(() => child.emit('close', 1))
    return child
  },
}))

/** Desktop programs, Qt's and GTK's, which abort without a display or open a dialog: no read may ever run one. */
const FORBIDDEN = [
  'plasmashell',
  'kwin',
  'kwin_x11',
  'kwin_wayland',
  'gnome-shell',
  'kreadconfig5',
  'kreadconfig6',
  'kwriteconfig5',
  'kwriteconfig6',
  'kdialog',
  'zenity',
  'qdbus',
]

/** A portal that answers each setting from a table, at once, as the real one does within a blink. */
const portalOf =
  (answers: Record<string, string | undefined>): typeof watchPortalSetting =>
  (namespace, key, parse, changed) => {
    const text = answers[`${namespace} ${key}`]
    queueMicrotask(() => changed(text === undefined ? undefined : parse(text)))
    return () => undefined
  }

interface Fake {
  readonly env: Record<string, string>
  readonly files?: Record<string, string>
  readonly prints?: Record<string, string>
  readonly portal?: Record<string, string | undefined>
  readonly platform?: string
  readonly cached?: unknown
  /** How long each probe takes to answer, in ms. */
  readonly slow?: number
}

const sourcesOf = (fake: Fake) => {
  const ran: Array<{ command: string; args: readonly string[]; timeout: number }> = []
  const written: unknown[] = []
  const sources: ChromeSources = {
    platform: fake.platform ?? 'linux',
    env: fake.env,
    home: '/home/someone',
    readText: (path) => {
      const text = fake.files?.[path]
      return text === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(text)
    },
    run: (command, args, timeout) => {
      ran.push({ command, args, timeout })
      const out = fake.prints?.[`${command} ${args.join(' ')}`]
      const answer = () => (out === undefined ? Promise.reject(new Error('failed')) : Promise.resolve(out))
      return fake.slow === undefined ? answer() : new Promise((resolve) => setTimeout(resolve, fake.slow)).then(answer)
    },
    watchPortal: portalOf(fake.portal ?? {}),
    cache: {
      read: () => (fake.cached === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(fake.cached)),
      write: (cached) => {
        written.push(cached)
        return Promise.resolve()
      },
    },
  }
  return { sources, ran, written }
}

/** Lets every read that was started finish. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

const GNOME_WAYLAND = { XDG_CURRENT_DESKTOP: 'GNOME', XDG_SESSION_TYPE: 'wayland' }
const SHELL_VERSION =
  'gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.freedesktop.DBus.Properties.Get org.gnome.Shell ShellVersion'

describe('reading the desktop', () => {
  afterEach(() => {
    spawned.length = 0
  })

  it('on GNOME: the portal’s layout, theme and accent, and the shell’s version over D-Bus', async () => {
    const { sources, ran, written } = sourcesOf({
      env: GNOME_WAYLAND,
      prints: { [SHELL_VERSION]: "(<'47.1'>,)" },
      portal: {
        'org.gnome.desktop.wm.preferences button-layout': "(<<'close,minimize:maximize'>>,)",
        'org.gnome.desktop.interface gtk-theme': "(<<'Yaru'>>,)",
        'org.freedesktop.appearance accent-color': '(<<(0.2, 0.5, 0.9)>>,)',
      },
    })
    const followed = followDesktopChrome(sources)
    const first = await followed.first(1000)
    expect(chromeOf(first, false)).toEqual({
      kind: 'drawn',
      look: 'gnome',
      tone: 'yaru',
      family: 'gnome',
      layout: { start: ['close', 'minimize'], end: ['maximize'] },
      accent: { r: 51, g: 128, b: 230 },
    })
    await settled()
    expect(followed.current().facts.gnomeVersion).toBe(47)
    expect(ran.map((one) => one.command)).toEqual(['gdbus'])
    expect(ran.every((one) => one.timeout > 0 && one.timeout <= 2000)).toBe(true)
    expect(written).toEqual([{ desktop: 'linux|wayland|gnome|GNOME|', facts: { gnomeVersion: 47 } }])
    followed.stop()
  })

  it('on GNOME with no portal: GNOME’s own default, close alone at the end, and no accent', async () => {
    const { sources } = sourcesOf({ env: GNOME_WAYLAND })
    const followed = followDesktopChrome(sources)
    expect(chromeOf(await followed.first(1000), false)).toMatchObject({ layout: { start: [], end: ['close'] }, accent: null })
  })

  it('on KDE: one bar, KDE’s buttons in kwinrc’s order; KWin’s files read as text through the cascade, never by a program', async () => {
    const { sources, ran } = sourcesOf({
      env: {
        XDG_CURRENT_DESKTOP: 'KDE',
        XDG_SESSION_TYPE: 'wayland',
        KDE_SESSION_VERSION: '6',
        XDG_CONFIG_DIRS: '/etc/xdg:/usr/share/kde-settings/kde-profile/default/xdg',
      },
      files: {
        '/home/someone/.config/kwinrc': '[org.kde.kdecoration2]\nButtonsOnLeft=X\n',
        '/usr/share/kde-settings/kde-profile/default/xdg/kwinrc': '[org.kde.kdecoration2]\nButtonsOnRight=IA\nlibrary=org.kde.breeze\n',
        '/home/someone/.config/kdeglobals': '[General]\nColorScheme=BreezeDark\n',
      },
    })
    const followed = followDesktopChrome(sources)
    const look = await followed.first(1000)
    expect(decideChrome(look.facts)).toEqual({ kind: 'drawn', look: 'kde' })
    // The first window already has kwinrc's order: it waited for the files.
    expect(chromeOf(look, false)).toMatchObject({
      kind: 'drawn',
      look: 'kde',
      family: 'kde',
      layout: { start: ['close'], end: ['minimize', 'maximize'] },
    })
    await settled()
    expect(followed.current().facts).toMatchObject({ plasmaVersion: 6, kdeDecoration: 'org.kde.breeze', kdeColorScheme: 'BreezeDark' })
    expect(ran).toEqual([])
  })

  it('on X11: the window manager’s own name, from xprop, wins over the desktop’s', async () => {
    const { sources, ran } = sourcesOf({
      env: { XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' },
      prints: {
        'xprop -root -notype _NET_SUPPORTING_WM_CHECK': '_NET_SUPPORTING_WM_CHECK: window id # 0x1e00003',
        'xprop -id 0x1e00003 -notype _NET_WM_NAME': '_NET_WM_NAME = "i3"',
      },
    })
    const followed = followDesktopChrome(sources)
    // The first window waits for xprop's word: it opens bare already.
    expect(decideChrome((await followed.first(1000)).facts).kind).toBe('bare')
    expect(ran.map((one) => one.command)).toEqual(['xprop', 'xprop', 'xprop'])
  })

  const OLD_WM = {
    'xprop -root -notype _NET_SUPPORTING_WM_CHECK': '_NET_SUPPORTING_WM_CHECK: window id # 0x1e00003',
    'xprop -id 0x1e00003 -notype _NET_WM_NAME': '_NET_WM_NAME = "oldwm"',
    'xprop -root -notype _NET_SUPPORTED': '_NET_SUPPORTED = _NET_SUPPORTED, _NET_WM_NAME',
  }

  it('on X11, first launch: the first window waits for whether the window manager moves it, its frame hanging on it', async () => {
    const { sources } = sourcesOf({
      env: { XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' },
      prints: OLD_WM,
      slow: 30,
    })
    const followed = followDesktopChrome(sources)
    expect(decideChrome((await followed.first(1000)).facts)).toEqual({ kind: 'frame' })
  })

  it('on X11: the first window waits for xprop past the time it was given for the rest, as main.ts gives it', async () => {
    const { sources } = sourcesOf({
      env: { XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' },
      prints: OLD_WM,
      slow: 150,
    })
    const followed = followDesktopChrome(sources)
    const started = Date.now()
    // Each of xprop's two stages takes longer than the whole wait: the window still opens framed, never frameless.
    expect(decideChrome((await followed.first(100)).facts)).toEqual({ kind: 'frame' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
    // And with what the cache kept of a window manager that moved it: xprop's word now, not the cache's.
    const kept = { desktop: 'linux|x11|xfce|XFCE|', facts: { wm: 'xfwm4', wmMoves: true } }
    const stale = followDesktopChrome(
      sourcesOf({ env: { XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, prints: OLD_WM, cached: kept, slow: 150 })
        .sources,
    )
    expect(decideChrome((await stale.first(100)).facts)).toEqual({ kind: 'frame' })
  })

  it('off X11, the first window waits no longer than it was given', async () => {
    const { sources } = sourcesOf({ env: { XDG_CURRENT_DESKTOP: 'MATE', XDG_SESSION_TYPE: 'wayland' }, slow: 400 })
    const started = Date.now()
    await followDesktopChrome(sources).first(50)
    expect(Date.now() - started).toBeLessThan(300)
  })

  it('on X11: xprop’s word now over what the cache kept of another window manager, either way', async () => {
    const env = { XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }
    const keptMoving = { desktop: 'linux|x11|xfce|XFCE|', facts: { wm: 'xfwm4', wmMoves: true } }
    const now = followDesktopChrome(sourcesOf({ env, prints: OLD_WM, cached: keptMoving, slow: 10 }).sources)
    expect(decideChrome((await now.first(1000)).facts)).toEqual({ kind: 'frame' })
    const keptStill = { desktop: 'linux|x11|xfce|XFCE|', facts: { wm: 'oldwm', wmMoves: false } }
    const moving = followDesktopChrome(
      sourcesOf({
        env,
        cached: keptStill,
        prints: {
          'xprop -root -notype _NET_SUPPORTING_WM_CHECK': '_NET_SUPPORTING_WM_CHECK: window id # 0x1e00003',
          'xprop -id 0x1e00003 -notype _NET_WM_NAME': '_NET_WM_NAME = "Xfwm4"',
          'xprop -root -notype _NET_SUPPORTED': '_NET_SUPPORTED = _NET_SUPPORTED, _NET_WM_MOVERESIZE',
        },
      }).sources,
    )
    expect(decideChrome((await moving.first(1000)).facts)).toMatchObject({ kind: 'drawn' })
    // No window manager now, where the cache kept one that couldn't move it: one bar.
    const none = followDesktopChrome(
      sourcesOf({
        env,
        cached: keptStill,
        prints: {
          'xprop -root -notype _NET_SUPPORTING_WM_CHECK': '_NET_SUPPORTING_WM_CHECK:  not found.',
          'xprop -root -notype': '_XKB_RULES_NAMES = "evdev", "pc105", "us", "", ""',
        },
      }).sources,
    )
    expect(decideChrome((await none.first(1000)).facts)).toMatchObject({ kind: 'drawn' })
  })

  it('on X11 with a window manager from before EWMH: its marks on the root window keep the system’s frame', async () => {
    const { sources, ran } = sourcesOf({
      env: { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' },
      prints: {
        'xprop -root -notype _NET_SUPPORTING_WM_CHECK': '_NET_SUPPORTING_WM_CHECK:  not found.',
        'xprop -root -notype': '_MOTIF_WM_INFO = 0x2, 0x1a00005\n_XKB_RULES_NAMES = "evdev", "pc105", "us", "", ""',
      },
    })
    expect(decideChrome((await followDesktopChrome(sources).first(1000)).facts)).toEqual({ kind: 'frame' })
    expect(ran.map((one) => one.args.join(' '))).toEqual(['-root -notype _NET_SUPPORTING_WM_CHECK', '-root -notype'])
  })

  it('keeps the window manager’s frame where its double-click on the title bar was set to do something else than maximize', async () => {
    const first = async (desktop: string, fake: Omit<Fake, 'env'>) =>
      decideChrome(
        (
          await followDesktopChrome(sourcesOf({ env: { XDG_CURRENT_DESKTOP: desktop, XDG_SESSION_TYPE: 'x11' }, ...fake }).sources).first(
            1000,
          )
        ).facts,
      )
    const kwinrc = (command: string) => ({
      files: { '/home/someone/.config/kwinrc': `[Windows]\nTitlebarDoubleClickCommand=${command}\n` },
    })
    expect(await first('KDE', kwinrc('Shade'))).toEqual({ kind: 'frame' })
    expect(await first('KDE', kwinrc('Nothing'))).toEqual({ kind: 'frame' })
    expect(await first('KDE', kwinrc('Maximize'))).toEqual({ kind: 'drawn', look: 'kde' })
    const xfwm = (action: string) => ({
      files: {
        '/home/someone/.config/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml': `<channel name="xfwm4"><property name="double_click_action" type="string" value="${action}"/></channel>`,
      },
    })
    expect(await first('XFCE', xfwm('shade'))).toEqual({ kind: 'frame' })
    expect(await first('XFCE', xfwm('maximize'))).toMatchObject({ kind: 'drawn' })
    const click = (schema: string, value: string) => ({
      prints: { [`gsettings get ${schema} action-double-click-titlebar`]: `'${value}'\n` },
    })
    expect(await first('MATE', click('org.mate.Marco.general', 'toggle_shade'))).toEqual({ kind: 'frame' })
    expect(await first('MATE', click('org.mate.Marco.general', 'toggle_maximize'))).toMatchObject({ kind: 'drawn' })
    expect(await first('X-Cinnamon', click('org.cinnamon.desktop.wm.preferences', 'minimize'))).toEqual({ kind: 'frame' })
    expect(await first('X-Cinnamon', click('org.cinnamon.desktop.wm.preferences', 'toggle-maximize'))).toMatchObject({ kind: 'drawn' })
    // Unread, the default: maximize, one bar.
    expect(await first('MATE', {})).toMatchObject({ kind: 'drawn' })
  })

  it('on X11: keeps, for the next start, that the window manager can’t move a frameless window', async () => {
    const { sources, written } = sourcesOf({
      env: { XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' },
      prints: {
        'xprop -root -notype _NET_SUPPORTING_WM_CHECK': '_NET_SUPPORTING_WM_CHECK: window id # 0x1e00003',
        'xprop -id 0x1e00003 -notype _NET_WM_NAME': '_NET_WM_NAME = "oldwm"',
        'xprop -root -notype _NET_SUPPORTED': '_NET_SUPPORTED = _NET_SUPPORTED, _NET_WM_NAME',
      },
    })
    const followed = followDesktopChrome(sources)
    await followed.first(1000)
    await settled()
    expect(decideChrome(followed.current().facts)).toEqual({ kind: 'frame' })
    expect(written).toEqual([{ desktop: 'linux|x11|xfce|XFCE|', facts: { wm: 'oldwm', wmMoves: false } }])
    const next = followDesktopChrome(
      sourcesOf({ env: { XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11' }, cached: written[0] }).sources,
    )
    expect(decideChrome((await next.first(1000)).facts)).toEqual({ kind: 'frame' })
  })

  it('on X11 with no window manager that says so: nothing known of it, and one bar', async () => {
    const { sources } = sourcesOf({
      env: { XDG_SESSION_TYPE: 'x11', DISPLAY: ':99' },
      prints: { 'xprop -root -notype _NET_SUPPORTING_WM_CHECK': '_NET_SUPPORTING_WM_CHECK:  not found.' },
    })
    const followed = followDesktopChrome(sources)
    await followed.first(1000)
    await settled()
    expect(chromeOf(followed.current(), false)).toMatchObject({
      kind: 'drawn',
      layout: { start: [], end: ['minimize', 'maximize', 'close'] },
    })
  })

  it('takes last time’s findings for the same desktop at once, and none from another', async () => {
    const env = { XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11' }
    const same = followDesktopChrome(sourcesOf({ env, cached: { desktop: 'linux|x11|xfce|XFCE|', facts: { wm: 'i3' } } }).sources)
    expect(decideChrome((await same.first(1000)).facts).kind).toBe('bare')
    const other = followDesktopChrome(sourcesOf({ env, cached: { desktop: 'linux|x11|kde|KDE|', facts: { wm: 'i3' } } }).sources)
    expect(decideChrome((await other.first(1000)).facts).kind).toBe('drawn')
    const broken = followDesktopChrome(sourcesOf({ env, cached: { desktop: 'linux|x11|xfce|XFCE|', facts: { wm: 42 } } }).sources)
    expect(decideChrome((await broken.first(1000)).facts).kind).toBe('drawn')
    const notMoves = followDesktopChrome(sourcesOf({ env, cached: { desktop: 'linux|x11|xfce|XFCE|', facts: { wmMoves: 'no' } } }).sources)
    expect(decideChrome((await notMoves.first(1000)).facts).kind).toBe('drawn')
  })

  it('on Windows and a Mac: the accent from Electron, and its changes', async () => {
    let accent = '0078d4ff'
    let changed: (() => void) | undefined
    const { sources } = sourcesOf({ env: {}, platform: 'win32' })
    const followed = followDesktopChrome({
      ...sources,
      systemAccent: () => ({
        r: Number.parseInt(accent.slice(0, 2), 16),
        g: Number.parseInt(accent.slice(2, 4), 16),
        b: Number.parseInt(accent.slice(4, 6), 16),
      }),
      onSystemAccent: (listener) => {
        changed = listener
        return () => undefined
      },
    })
    expect(chromeOf(await followed.first(1000), false)).toEqual({
      kind: 'drawn',
      look: 'windows',
      family: 'windows',
      layout: { start: [], end: ['minimize', 'maximize', 'close'] },
      accent: { r: 0, g: 120, b: 212 },
    })
    const heard: unknown[] = []
    followed.follow((look) => heard.push(look.accent))
    accent = 'e81123ff'
    changed?.()
    expect(heard).toEqual([{ r: 232, g: 17, b: 35 }])
  })

  const GSETTINGS_LAYOUT = 'gsettings get org.gnome.desktop.wm.preferences button-layout'

  it('on GNOME without the layout in the portal: reads it from gsettings, and the first window waits for it', async () => {
    const { sources, ran } = sourcesOf({ env: GNOME_WAYLAND, prints: { [GSETTINGS_LAYOUT]: "'close,minimize:'\n" } })
    const followed = followDesktopChrome(sources)
    const first = await followed.first(1000)
    expect(chromeOf(first, false).layout).toEqual({ start: ['close', 'minimize'], end: [] })
    expect(ran.filter((one) => one.command === 'gsettings')).toHaveLength(1)
  })

  it('reads no gsettings where the portal gives the layout', async () => {
    const { sources, ran } = sourcesOf({
      env: GNOME_WAYLAND,
      prints: { [GSETTINGS_LAYOUT]: "'close:'" },
      portal: { 'org.gnome.desktop.wm.preferences button-layout': "(<<'appmenu:minimize,close'>>,)" },
    })
    const first = await followDesktopChrome(sources).first(1000)
    expect(chromeOf(first, false).layout).toEqual({ start: [], end: ['minimize', 'close'] })
    expect(ran.map((one) => one.command)).not.toContain('gsettings')
  })

  it.each([
    ['fails', undefined],
    ['prints something malformed', "'close;minimize:maximize'"],
    ['prints nothing', ''],
  ])('keeps GNOME’s own layout, close alone at the end, where gsettings %s', async (_how, out) => {
    const { sources } = sourcesOf({ env: GNOME_WAYLAND, ...(out === undefined ? {} : { prints: { [GSETTINGS_LAYOUT]: out } }) })
    const first = await followDesktopChrome(sources).first(1000)
    expect(chromeOf(first, false).layout).toEqual({ start: [], end: ['close'] })
  })

  it('asks gsettings nothing on KDE, whose layout is kwinrc’s, or Xfce, whose is xfconf’s; and not GNOME’s key on another desktop', async () => {
    for (const desktop of ['KDE', 'XFCE']) {
      const { sources, ran } = sourcesOf({ env: { XDG_CURRENT_DESKTOP: desktop, XDG_SESSION_TYPE: 'wayland' } })
      await followDesktopChrome(sources).first(1000)
      await settled()
      expect(ran.map((one) => one.command)).not.toContain('gsettings')
    }
    for (const desktop of ['X-Cinnamon', 'MATE']) {
      const { sources, ran } = sourcesOf({ env: { XDG_CURRENT_DESKTOP: desktop, XDG_SESSION_TYPE: 'wayland' } })
      await followDesktopChrome(sources).first(1000)
      await settled()
      expect(ran.map((one) => one.args.join(' '))).not.toContain('get org.gnome.desktop.wm.preferences button-layout')
    }
  })

  it('takes no word of GNOME’s key on a desktop that keeps its own: the portal’s GNOME layout leaves Xfce’s default', async () => {
    const { sources } = sourcesOf({
      env: { XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11' },
      portal: { 'org.gnome.desktop.wm.preferences button-layout': "(<<'appmenu:close'>>,)" },
    })
    expect(chromeOf(await followDesktopChrome(sources).first(1000), false).layout).toEqual({
      start: [],
      end: ['minimize', 'maximize', 'close'],
    })
  })

  const own = (desktop: string, session: string, fake: Omit<Fake, 'env'>) =>
    followDesktopChrome(sourcesOf({ env: { XDG_CURRENT_DESKTOP: desktop, XDG_SESSION_TYPE: session }, ...fake }).sources)
      .first(1000)
      .then((look) => chromeOf(look, false).layout)

  it('reads Cinnamon’s and MATE’s layouts from their own gsettings keys', async () => {
    expect(
      await own('X-Cinnamon', 'x11', {
        prints: { 'gsettings get org.cinnamon.desktop.wm.preferences button-layout': "'close:minimize'\n" },
      }),
    ).toEqual({ start: ['close'], end: ['minimize'] })
    expect(
      await own('MATE', 'x11', { prints: { 'gsettings get org.mate.Marco.general button-layout': "'menu:minimize,maximize,close'\n" } }),
    ).toEqual({ start: [], end: ['minimize', 'maximize', 'close'] })
    // Unread, each one's default.
    expect(await own('X-Cinnamon', 'x11', {})).toEqual({ start: [], end: ['minimize', 'maximize', 'close'] })
  })

  it('reads Xfwm4’s, Openbox’s, labwc’s, Wayfire’s and COSMIC’s from their files, the person’s before the system’s', async () => {
    const xfwm = (value: string) => `<channel name="xfwm4"><property name="button_layout" type="string" value="${value}"/></channel>`
    expect(
      await own('XFCE', 'x11', {
        files: {
          '/home/someone/.config/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml': '<channel name="xfwm4"/>',
          '/etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml': xfwm('CMH|O'),
        },
      }),
    ).toEqual({ start: ['close', 'maximize', 'minimize'], end: [] })
    expect(
      await own('LXDE', 'x11', {
        files: {
          '/home/someone/.config/openbox/lxde-rc.xml': '<theme><titleLayout>CLIM</titleLayout></theme>',
          '/home/someone/.config/openbox/rc.xml': '<theme><titleLayout>NLIMC</titleLayout></theme>',
        },
      }),
    ).toEqual({ start: ['close'], end: ['minimize', 'maximize'] })
    expect(
      await own('labwc', 'wayland', {
        files: { '/home/someone/.config/labwc/rc.xml': '<titlebar><layout>close:iconify</layout></titlebar>' },
      }),
    ).toEqual({ start: ['close'], end: ['minimize'] })
    expect(
      await own('wayfire', 'wayland', { files: { '/home/someone/.config/wayfire.ini': '[decoration]\nbutton_order = close\n' } }),
    ).toEqual({ start: [], end: ['close'] })
    expect(
      await own('COSMIC', 'wayland', {
        files: { '/home/someone/.config/cosmic/com.system76.CosmicTk/v1/show_minimize': 'false' },
      }),
    ).toEqual({ start: [], end: ['maximize', 'close'] })
  })

  it('reads the layout where the window manager X11 names keeps it, over the desktop’s own', async () => {
    const { sources } = sourcesOf({
      env: { XDG_CURRENT_DESKTOP: 'LXQt', XDG_SESSION_TYPE: 'x11' },
      prints: {
        'xprop -root -notype _NET_SUPPORTING_WM_CHECK': '_NET_SUPPORTING_WM_CHECK: window id # 0x1e00003',
        'xprop -id 0x1e00003 -notype _NET_WM_NAME': '_NET_WM_NAME = "KWin"',
      },
      files: {
        '/home/someone/.config/openbox/lxqt-rc.xml': '<theme><titleLayout>CLIM</titleLayout></theme>',
        '/home/someone/.config/kwinrc': '[org.kde.kdecoration2]\nButtonsOnLeft=\nButtonsOnRight=AX\n',
      },
    })
    const followed = followDesktopChrome(sources)
    await followed.first(1000)
    await settled()
    expect(chromeOf(followed.current(), false)).toMatchObject({ look: 'kde', layout: { start: [], end: ['maximize', 'close'] } })
    // Without that word, LXQt's Openbox.
    const plain = sourcesOf({
      env: { XDG_CURRENT_DESKTOP: 'LXQt', XDG_SESSION_TYPE: 'x11' },
      files: {
        '/home/someone/.config/openbox/lxqt-rc.xml': '<theme><titleLayout>CLIM</titleLayout></theme>',
      },
    })
    expect(chromeOf(await followDesktopChrome(plain.sources).first(1000), false).layout).toEqual({
      start: ['close'],
      end: ['minimize', 'maximize'],
    })
  })

  it('settles the first window’s wait after its time even where nothing answers', async () => {
    const { sources } = sourcesOf({ env: GNOME_WAYLAND })
    const silent = followDesktopChrome({ ...sources, watchPortal: () => () => undefined })
    const started = Date.now()
    await silent.first(50)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('reads KDE’s files from XDG_CONFIG_HOME and XDG_CONFIG_DIRS, else ~/.config and /etc/xdg', () => {
    expect(configCascade('kwinrc', {}, '/home/a')).toEqual(['/home/a/.config/kwinrc', '/etc/xdg/kwinrc'])
    expect(configCascade('kwinrc', { XDG_CONFIG_HOME: '/c', XDG_CONFIG_DIRS: '/x:relative:/y' }, '/home/a')).toEqual([
      '/c/kwinrc',
      '/x/kwinrc',
      '/y/kwinrc',
    ])
  })
})

describe('the system’s own reads', () => {
  afterEach(() => {
    spawned.length = 0
  })

  /* Each desktop the detection knows, as its session would set the environment. */
  const SESSIONS: Record<string, Record<string, string>> = {
    'GNOME on Wayland': GNOME_WAYLAND,
    'GNOME on X11': { XDG_CURRENT_DESKTOP: 'GNOME', XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' },
    'Plasma 6 on Wayland': { XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland', KDE_SESSION_VERSION: '6', KDE_FULL_SESSION: 'true' },
    'Plasma 5 on X11': { XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'x11', KDE_SESSION_VERSION: '5', DISPLAY: ':0' },
    Cinnamon: { XDG_CURRENT_DESKTOP: 'X-Cinnamon', XDG_SESSION_TYPE: 'x11' },
    MATE: { XDG_CURRENT_DESKTOP: 'MATE', XDG_SESSION_TYPE: 'x11' },
    Xfce: { XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11' },
    Budgie: { XDG_CURRENT_DESKTOP: 'Budgie:GNOME', XDG_SESSION_TYPE: 'x11' },
    Pantheon: { XDG_CURRENT_DESKTOP: 'Pantheon', XDG_SESSION_TYPE: 'wayland' },
    COSMIC: { XDG_CURRENT_DESKTOP: 'COSMIC', XDG_SESSION_TYPE: 'wayland' },
    LXQt: { XDG_CURRENT_DESKTOP: 'LXQt', XDG_SESSION_TYPE: 'x11' },
    sway: { XDG_CURRENT_DESKTOP: 'sway', XDG_SESSION_TYPE: 'wayland', SWAYSOCK: '/run/sway' },
    Hyprland: { XDG_CURRENT_DESKTOP: 'Hyprland', HYPRLAND_INSTANCE_SIGNATURE: 'x' },
    unknown: {},
  }

  it.each(Object.entries(SESSIONS))('on %s, runs no desktop program: only gdbus, xprop and gsettings', async (_name, env) => {
    const home = await mkdtemp(join(tmpdir(), 'chrome-'))
    const followed = followDesktopChrome(systemSources({ platform: 'linux', env: { ...env, XDG_CONFIG_DIRS: home }, home, profile: home }))
    await followed.first(200)
    await settled()
    followed.stop()
    expect(spawned.length).toBeGreaterThan(0)
    for (const command of spawned) {
      expect(PROBES).toContain(command)
      expect(FORBIDDEN).not.toContain(command)
    }
  })

  it('refuses to run anything but a probe', async () => {
    const sources = systemSources({ platform: 'linux', env: {}, home: '/nowhere' })
    // @ts-expect-error: only a probe may be named
    await expect(sources.run('plasmashell', ['--version'], 100)).rejects.toThrow('not a probe')
    expect(spawned).toEqual([])
  })

  it('keeps the cache in the profile, and reads it back', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'chrome-'))
    const { cache } = systemSources({ platform: 'linux', env: {}, home: profile, profile })
    await cache?.write({ desktop: 'd', facts: { wm: 'xfwm4' } })
    expect(JSON.parse(await readFile(join(profile, CHROME_CACHE), 'utf8'))).toEqual({ desktop: 'd', facts: { wm: 'xfwm4' } })
    expect(await cache?.read()).toEqual({ desktop: 'd', facts: { wm: 'xfwm4' } })
    await writeFile(join(profile, CHROME_CACHE), '{ not json')
    await expect(cache?.read()).rejects.toThrow()
  })
})
