import { describe, expect, it } from 'vitest'

import {
  chromeFromArgs,
  CHROME_ARG,
  decideChrome,
  decideFor,
  type DesktopFacts,
  factsFromEnv,
  kdeFacts,
  kwinLayout,
  parseGnomeLayout,
  parseHexAccent,
  parseIni,
  parsePortalAccent,
  parseShellVersion,
  parseThemeName,
  parseXpropName,
  parseXpropWindow,
  sessionOf,
  withFacts,
  wmFromName,
} from '../src/main/desktop'

/* Every fixture here is a string or an object: nothing reads this computer's own desktop, config or bus. */

const linux = (env: Record<string, string>) => factsFromEnv('linux', env)

describe('the session', () => {
  it('is what XDG_SESSION_TYPE says, else what display there is', () => {
    expect(sessionOf({ XDG_SESSION_TYPE: 'wayland' })).toBe('wayland')
    expect(sessionOf({ XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'wayland-0' })).toBe('x11')
    expect(sessionOf({ XDG_SESSION_TYPE: 'tty', WAYLAND_DISPLAY: 'wayland-0' })).toBe('wayland')
    expect(sessionOf({ DISPLAY: ':0' })).toBe('x11')
    expect(sessionOf({ XDG_SESSION_TYPE: 'Wayland ' })).toBe('wayland')
    expect(sessionOf({})).toBe('unknown')
  })
})

describe('the desktop, from the environment', () => {
  it('names a Mac and Windows by the system alone', () => {
    expect(factsFromEnv('darwin', { XDG_CURRENT_DESKTOP: 'KDE' }).family).toBe('mac')
    expect(factsFromEnv('win32', {}).family).toBe('windows')
  })

  it('reads GNOME and its remixes, colon lists included', () => {
    for (const desktop of ['GNOME', 'ubuntu:GNOME', 'pop:GNOME', 'Zorin:GNOME', 'GNOME-Classic:GNOME'])
      expect(linux({ XDG_CURRENT_DESKTOP: desktop }).family).toBe('gnome')
    expect(linux({ DESKTOP_SESSION: 'gnome-xorg' }).family).toBe('gnome')
    expect(linux({ GNOME_SHELL_SESSION_MODE: 'user' }).family).toBe('gnome')
  })

  it('reads KDE by its name, its session or its own variables, with Plasma’s version', () => {
    expect(linux({ XDG_CURRENT_DESKTOP: 'KDE', KDE_SESSION_VERSION: '6' })).toEqual({
      platform: 'linux',
      session: 'unknown',
      family: 'kde',
      wm: 'kwin',
      plasmaVersion: 6,
    })
    expect(linux({ DESKTOP_SESSION: '/usr/share/xsessions/plasma' }).family).toBe('kde')
    expect(linux({ DESKTOP_SESSION: 'plasmawayland.desktop' }).family).toBe('kde')
    expect(linux({ KDE_FULL_SESSION: 'true' }).family).toBe('kde')
    expect(linux({ KDE_SESSION_VERSION: '5' }).plasmaVersion).toBe(5)
    // A version that isn't one is left out.
    expect(linux({ XDG_CURRENT_DESKTOP: 'KDE', KDE_SESSION_VERSION: 'six' }).plasmaVersion).toBeUndefined()
  })

  it('reads the other desktops and their window managers', () => {
    expect(linux({ XDG_CURRENT_DESKTOP: 'X-Cinnamon' })).toMatchObject({ family: 'cinnamon', wm: 'muffin' })
    expect(linux({ XDG_CURRENT_DESKTOP: 'MATE' })).toMatchObject({ family: 'mate', wm: 'marco' })
    expect(linux({ XDG_CURRENT_DESKTOP: 'XFCE' }).family).toBe('xfce')
    expect(linux({ XDG_CURRENT_DESKTOP: 'Budgie:GNOME' }).family).toBe('budgie')
    expect(linux({ XDG_CURRENT_DESKTOP: 'Pantheon' })).toMatchObject({ family: 'pantheon', wm: 'gala' })
    expect(linux({ XDG_CURRENT_DESKTOP: 'COSMIC' })).toMatchObject({ family: 'cosmic', wm: 'cosmic-comp' })
    expect(linux({ XDG_CURRENT_DESKTOP: 'LXQt' }).family).toBe('lxqt')
    expect(linux({ XDG_CURRENT_DESKTOP: 'LXDE' })).toMatchObject({ family: 'lxde', wm: 'openbox' })
    expect(linux({ XDG_CURRENT_DESKTOP: 'Unity' })).toMatchObject({ family: 'unity', wm: 'compiz' })
    expect(linux({ XDG_CURRENT_DESKTOP: 'Deepin' }).family).toBe('deepin')
    expect(linux({ XDG_CURRENT_DESKTOP: 'labwc:wlroots' })).toMatchObject({ family: 'unknown', wm: 'labwc' })
  })

  it('reads the tiling compositors, by name or by the socket they leave, over the desktop’s name', () => {
    for (const name of ['sway', 'Hyprland', 'i3', 'river', 'niri', 'bspwm', 'qtile'])
      expect(linux({ XDG_CURRENT_DESKTOP: name }).family).toBe('tiling')
    expect(linux({ XDG_CURRENT_DESKTOP: 'XFCE', I3SOCK: '/run/user/1000/i3/ipc' })).toMatchObject({ family: 'tiling', wm: 'i3' })
    expect(linux({ XDG_CURRENT_DESKTOP: 'GNOME', SWAYSOCK: '/run/sway.sock' })).toMatchObject({ family: 'tiling', wm: 'sway' })
    expect(linux({ HYPRLAND_INSTANCE_SIGNATURE: 'abc' })).toMatchObject({ family: 'tiling', wm: 'hyprland' })
    expect(linux({ NIRI_SOCKET: '/run/niri.sock' })).toMatchObject({ family: 'tiling', wm: 'niri' })
  })

  it('reads a list in order, passing over names it doesn’t know, and leaves the rest unknown', () => {
    expect(linux({ XDG_CURRENT_DESKTOP: 'Foo:KDE' }).family).toBe('kde')
    expect(linux({ XDG_CURRENT_DESKTOP: '::', DESKTOP_SESSION: '' }).family).toBe('unknown')
    expect(linux({ XDG_CURRENT_DESKTOP: 'constructor' }).family).toBe('unknown')
    expect(linux({ XDG_CURRENT_DESKTOP: 'Enlightenment' })).toMatchObject({ wm: 'enlightenment' })
    expect(linux({}).family).toBe('unknown')
  })
})

describe('the X11 window manager, by its own name', () => {
  it('reads xprop’s window id and name', () => {
    expect(parseXpropWindow('_NET_SUPPORTING_WM_CHECK: window id # 0x1a00003\n')).toBe('0x1a00003')
    expect(parseXpropWindow('_NET_SUPPORTING_WM_CHECK:  not found.')).toBeUndefined()
    expect(parseXpropWindow("xprop: unable to open display ':0'")).toBeUndefined()
    expect(parseXpropName('_NET_WM_NAME = "Xfwm4"')).toBe('Xfwm4')
    expect(parseXpropName('_NET_WM_NAME(UTF8_STRING) = "Mutter (Muffin)"')).toBe('Mutter (Muffin)')
    expect(parseXpropName('_NET_WM_NAME:  not found.')).toBeUndefined()
  })

  it('names the window manager, forks included', () => {
    expect(wmFromName('Mutter (Muffin)')).toBe('muffin')
    expect(wmFromName('GNOME Shell')).toBe('mutter')
    expect(wmFromName('KWin')).toBe('kwin')
    expect(wmFromName('Xfwm4')).toBe('xfwm4')
    expect(wmFromName('Marco')).toBe('marco')
    expect(wmFromName('i3')).toBe('i3')
    expect(wmFromName('  ')).toBeUndefined()
    expect(wmFromName('"; rm -rf ~')).toBe('rm-rf')
  })

  it('wins over the desktop’s name, and a tiling one makes the session tiling', () => {
    const xfce = linux({ XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11' })
    expect(withFacts(xfce, { wm: 'xfwm4' })).toMatchObject({ family: 'xfce', wm: 'xfwm4' })
    expect(withFacts(xfce, { wm: 'i3' })).toMatchObject({ family: 'tiling', wm: 'i3' })
    // What couldn't be read leaves the fact as it was.
    expect(withFacts({ ...xfce, wm: 'xfwm4' }, { wm: undefined }).wm).toBe('xfwm4')
  })
})

describe('how the window is dressed, by desktop', () => {
  const on = (env: Record<string, string>, more: Partial<DesktopFacts> = {}) => decideChrome({ ...linux(env), ...more })
  const wayland = (desktop: string) => on({ XDG_CURRENT_DESKTOP: desktop, XDG_SESSION_TYPE: 'wayland' })
  const x11 = (desktop: string) => on({ XDG_CURRENT_DESKTOP: desktop, XDG_SESSION_TYPE: 'x11' })

  it('keeps a Mac’s traffic lights, and draws Windows’ caption buttons', () => {
    expect(decideChrome(factsFromEnv('darwin', {}))).toEqual({ kind: 'mac' })
    expect(decideChrome(factsFromEnv('win32', {}))).toEqual({ kind: 'drawn', look: 'windows' })
  })

  it('draws GNOME’s buttons on GNOME and the desktops whose apps draw their own bars, X11 too', () => {
    expect(wayland('GNOME')).toEqual({ kind: 'drawn', look: 'gnome', tone: 'adwaita' })
    expect(x11('GNOME')).toEqual({ kind: 'drawn', look: 'gnome', tone: 'adwaita' })
    expect(wayland('Budgie:GNOME')).toEqual({ kind: 'drawn', look: 'gnome', tone: 'legacy' })
    expect(x11('Pantheon')).toEqual({ kind: 'drawn', look: 'gnome', tone: 'legacy' })
  })

  it('tunes GNOME’s look for its version and theme', () => {
    expect(on({ XDG_CURRENT_DESKTOP: 'GNOME' }, { gnomeVersion: 3 })).toMatchObject({ tone: 'legacy' })
    expect(on({ XDG_CURRENT_DESKTOP: 'GNOME' }, { gnomeVersion: 47 })).toMatchObject({ tone: 'adwaita' })
    expect(on({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }, { gtkTheme: 'Yaru-dark' })).toMatchObject({ tone: 'yaru' })
    expect(on({ XDG_CURRENT_DESKTOP: 'GNOME' }, { gtkTheme: 'Adwaita' })).toMatchObject({ tone: 'adwaita' })
  })

  it('leaves the frame to a window manager that draws a good one: KWin on both sessions, xfwm4, Marco, Openbox, Muffin on X11', () => {
    expect(wayland('KDE')).toEqual({ kind: 'frame' })
    expect(x11('KDE')).toEqual({ kind: 'frame' })
    expect(x11('XFCE')).toEqual({ kind: 'frame' })
    expect(x11('MATE')).toEqual({ kind: 'frame' })
    expect(x11('LXDE')).toEqual({ kind: 'frame' })
    expect(x11('LXQt')).toEqual({ kind: 'frame' })
    expect(x11('X-Cinnamon')).toEqual({ kind: 'frame' })
    expect(x11('Unity')).toEqual({ kind: 'frame' })
    expect(wayland('COSMIC')).toEqual({ kind: 'frame' })
    expect(wayland('labwc')).toEqual({ kind: 'frame' })
  })

  it('draws them where the desktop would frame the window but its Wayland compositor can’t', () => {
    expect(wayland('X-Cinnamon')).toEqual({ kind: 'drawn', look: 'gnome', tone: 'legacy' })
    // Qt's desktops on a compositor not known to frame windows: KDE's manner.
    expect(on({ XDG_CURRENT_DESKTOP: 'LXQt', XDG_SESSION_TYPE: 'wayland' }, { wm: 'mystery' })).toEqual({ kind: 'drawn', look: 'kde' })
  })

  it('draws GNOME’s where GNOME’s window manager runs under another desktop’s name', () => {
    expect(on({ XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11' }, { wm: 'mutter' })).toMatchObject({ kind: 'drawn', look: 'gnome' })
  })

  it('draws no buttons on a tiling compositor', () => {
    for (const name of ['sway', 'Hyprland', 'i3', 'river', 'niri']) expect(wayland(name)).toEqual({ kind: 'bare' })
    expect(on({ XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'x11' }, { wm: 'i3' })).toEqual({ kind: 'bare' })
  })

  it('draws neutral ones on a desktop it doesn’t know', () => {
    expect(wayland('Foo')).toEqual({ kind: 'drawn', look: 'gnome', tone: 'legacy' })
    expect(on({ XDG_SESSION_TYPE: 'x11' })).toEqual({ kind: 'drawn', look: 'gnome', tone: 'legacy' })
    // An X11 window manager it knows draws the frame, whatever the desktop.
    expect(on({ XDG_SESSION_TYPE: 'x11' }, { wm: 'openbox' })).toEqual({ kind: 'frame' })
  })

  it('keeps a window’s frame as it opened: framed stays framed, unframed draws its desktop’s buttons', () => {
    const kde = linux({ XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland' })
    expect(decideFor(kde, true)).toEqual({ kind: 'frame' })
    expect(decideFor(kde, false)).toEqual({ kind: 'drawn', look: 'kde' })
    const gnome = linux({ XDG_CURRENT_DESKTOP: 'GNOME', XDG_SESSION_TYPE: 'wayland' })
    expect(decideFor(gnome, false)).toEqual({ kind: 'drawn', look: 'gnome', tone: 'adwaita' })
  })
})

describe('GNOME’s button layout', () => {
  it('reads each side in order, as the portal prints it or bare', () => {
    expect(parseGnomeLayout("(<<'appmenu:minimize,maximize,close'>>,)")).toEqual({ start: [], end: ['minimize', 'maximize', 'close'] })
    expect(parseGnomeLayout('appmenu:close')).toEqual({ start: [], end: ['close'] })
    expect(parseGnomeLayout("<'close,minimize,maximize:'>")).toEqual({ start: ['close', 'minimize', 'maximize'], end: [] })
    expect(parseGnomeLayout("'close:maximize'")).toEqual({ start: ['close'], end: ['maximize'] })
  })

  it('passes over what isn’t a button, and draws each once', () => {
    expect(parseGnomeLayout("'icon,menu:spacer,close'")).toEqual({ start: [], end: ['close'] })
    expect(parseGnomeLayout("'close:close,minimize'")).toEqual({ start: ['close'], end: ['minimize'] })
    expect(parseGnomeLayout("'constructor,__proto__:close'")).toEqual({ start: [], end: ['close'] })
    expect(parseGnomeLayout("'appmenu:'")).toEqual({ start: [], end: [] })
  })

  it('puts everything on the left without a colon, as GTK does', () => {
    expect(parseGnomeLayout("'close,maximize'")).toEqual({ start: ['close', 'maximize'], end: [] })
  })

  it('reads nothing from what isn’t a layout', () => {
    expect(parseGnomeLayout("'a:b:c'")).toBeUndefined()
    expect(parseGnomeLayout("'close;rm'")).toBeUndefined()
    expect(parseGnomeLayout('Error: GDBus.Error:org.freedesktop.portal.Error.NotFound: Requested setting not found')).toBeUndefined()
    expect(parseGnomeLayout('(<<uint32 1>>,)')).toBeUndefined()
  })
})

describe('KDE’s files', () => {
  const kwinrc = parseIni(`
# KWin's own
[Compositing]
Backend=OpenGL

[org.kde.kdecoration2]
ButtonsOnLeft=XIA
ButtonsOnRight=HS
library=org.kde.kwin.aurorae
theme=__aurorae__svg__Sweet
`)

  it('reads KWin’s buttons, by letter, on each side', () => {
    expect(kwinLayout([kwinrc])).toEqual({ start: ['close', 'minimize', 'maximize'], end: [] })
    expect(kwinLayout([parseIni('[org.kde.kdecoration2]\nButtonsOnRight=IA_X\n')])).toEqual({
      start: [],
      end: ['minimize', 'maximize', 'close'],
    })
  })

  it('takes KWin’s defaults where no file says, and a side no file names', () => {
    expect(kwinLayout([])).toEqual({ start: [], end: ['minimize', 'maximize', 'close'] })
    expect(kwinLayout([parseIni('[org.kde.kdecoration2]\nButtonsOnLeft=X\n')])).toEqual({ start: ['close'], end: ['minimize', 'maximize'] })
  })

  it('reads the cascade: the person’s file first, then the system’s', () => {
    const system = parseIni('[org.kde.kdecoration2]\nButtonsOnLeft=X\nButtonsOnRight=IA\nlibrary=org.kde.oxygen\n')
    const own = parseIni('[org.kde.kdecoration2]\nButtonsOnRight=AX\n')
    // The left side is the system's (close), the right the person's (maximize, close): close shows once, where it comes first.
    expect(kwinLayout([own, system])).toEqual({ start: ['close'], end: ['maximize'] })
    expect(kdeFacts([own, system], [])).toEqual({ kdeDecoration: 'org.kde.oxygen' })
  })

  it('reads the decoration plugin and the colour scheme', () => {
    expect(kdeFacts([kwinrc], [parseIni('[General]\nColorScheme=BreezeDark\n')])).toEqual({
      kdeDecoration: 'org.kde.kwin.aurorae',
      kdeColorScheme: 'BreezeDark',
    })
  })

  it('survives malformed files: no group, broken lines, flags, a value that isn’t a name', () => {
    const broken = parseIni('ButtonsOnLeft=X\n[org.kde.kdecoration2\n=nothing\nButtonsOnRight[$i]=X\n[General]\nColorScheme=<script>\n')
    expect(kwinLayout([broken])).toEqual({ start: [], end: ['minimize', 'maximize', 'close'] })
    expect(kdeFacts([broken], [broken])).toEqual({})
    expect(kwinLayout([parseIni('[org.kde.kdecoration2]\nButtonsOnRight[$i]=X\n')])).toEqual({ start: [], end: ['close'] })
    expect(parseIni('\u0000\u0001garbage').size).toBe(0)
  })
})

describe('the version and the theme, as gdbus prints them', () => {
  it('reads GNOME Shell’s major version', () => {
    expect(parseShellVersion("(<'46.2'>,)")).toBe(46)
    expect(parseShellVersion("(<'3.38.6'>,)")).toBe(3)
    expect(parseShellVersion("(<'50'>,)")).toBe(50)
    expect(parseShellVersion("(<'beta'>,)")).toBeUndefined()
    expect(parseShellVersion('Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown')).toBeUndefined()
  })

  it('reads a theme’s name, and nothing that isn’t one', () => {
    expect(parseThemeName("(<<'Yaru-dark'>>,)")).toBe('Yaru-dark')
    expect(parseThemeName("<'Adwaita'>")).toBe('Adwaita')
    expect(parseThemeName("(<<''>>,)")).toBeUndefined()
    expect(parseThemeName('(<<uint32 1>>,)')).toBeUndefined()
  })
})

describe('the accent, as the system gives it', () => {
  it('reads the portal’s three channels, and its saying there is none', () => {
    expect(parsePortalAccent('(<<(0.20784313725490197, 0.51764705882352946, 0.89411764705882357)>>,)')).toEqual({ r: 53, g: 132, b: 228 })
    expect(parsePortalAccent(', <(1.0, 0.0, 0.5)>)')).toEqual({ r: 255, g: 0, b: 128 })
    expect(parsePortalAccent('(<<(-1.0, -1.0, -1.0)>>,)')).toBeNull()
    expect(parsePortalAccent('(<<(1.5, 0.2, 0.2)>>,)')).toBeNull()
    expect(parsePortalAccent('Error: GDBus.Error: No such interface')).toBeUndefined()
    expect(parsePortalAccent('(<<(0.1, 0.2)>>,)')).toBeUndefined()
  })

  it('reads Electron’s hex', () => {
    expect(parseHexAccent('0078d4ff')).toEqual({ r: 0, g: 120, b: 212 })
    expect(parseHexAccent('#3584e4')).toEqual({ r: 53, g: 132, b: 228 })
    expect(parseHexAccent('')).toBeNull()
    expect(parseHexAccent('blue')).toBeNull()
  })
})

describe('what the window is handed', () => {
  const chrome = {
    kind: 'drawn',
    look: 'gnome',
    tone: 'yaru',
    family: 'gnome',
    layout: { start: [], end: ['close'] },
    accent: { r: 1, g: 2, b: 3 },
  }

  it('reads it back from its argument', () => {
    expect(chromeFromArgs(['electron', `${CHROME_ARG}${JSON.stringify(chrome)}`])).toEqual(chrome)
    expect(chromeFromArgs(['electron'])).toBeUndefined()
  })

  it('refuses one that isn’t one', () => {
    expect(chromeFromArgs([`${CHROME_ARG}{`])).toBeUndefined()
    expect(chromeFromArgs([`${CHROME_ARG}${JSON.stringify({ ...chrome, kind: 'dots' })}`])).toBeUndefined()
    expect(chromeFromArgs([`${CHROME_ARG}${JSON.stringify({ ...chrome, layout: { start: ['help'], end: [] } })}`])).toBeUndefined()
    expect(chromeFromArgs([`${CHROME_ARG}${JSON.stringify({ ...chrome, accent: { r: 300, g: 0, b: 0 } })}`])).toBeUndefined()
  })
})
