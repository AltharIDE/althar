import { describe, expect, it } from 'vitest'

import {
  chromeFromArgs,
  CHROME_ARG,
  cosmicLayout,
  decideChrome,
  decideFor,
  defaultLayout,
  type DesktopFacts,
  factsFromEnv,
  kdeFacts,
  kwinDoubleClickMaximizes,
  kwinLayout,
  layoutSource,
  parseGnomeLayout,
  parseHexAccent,
  parseIni,
  parseLabwcLayout,
  parseOpenboxLayout,
  parsePortalAccent,
  parseShellVersion,
  parseThemeName,
  parseGsettingsDoubleClick,
  parseXfwmDoubleClick,
  parseXfwmLayout,
  parseXpropMoves,
  parseXpropName,
  parseXpropOlderWm,
  parseXpropWindow,
  sessionOf,
  wayfireLayout,
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

describe('the double-click on the title bar, as each window manager keeps it', () => {
  it('reads KWin’s, Maximize by default', () => {
    expect(kwinDoubleClickMaximizes([])).toBe(true)
    expect(kwinDoubleClickMaximizes([parseIni('[Windows]\nTitlebarDoubleClickCommand=Maximize\n')])).toBe(true)
    expect(kwinDoubleClickMaximizes([parseIni('[Windows]\nTitlebarDoubleClickCommand=Shade\n')])).toBe(false)
    expect(kwinDoubleClickMaximizes([parseIni('[Windows]\nTitlebarDoubleClickCommand=Maximize (vertical only)\n')])).toBe(false)
  })

  it('reads Xfwm4’s, and Marco’s and Muffin’s from gsettings', () => {
    const xml = (value: string) => `<property name="double_click_action" type="string" value="${value}"/>`
    expect(parseXfwmDoubleClick(xml('maximize'))).toBe(true)
    expect(parseXfwmDoubleClick(xml('none'))).toBe(false)
    expect(parseXfwmDoubleClick('<channel name="xfwm4"/>')).toBeUndefined()
    expect(parseGsettingsDoubleClick("'toggle_maximize'\n")).toBe(true)
    expect(parseGsettingsDoubleClick("'toggle-maximize'\n")).toBe(true)
    expect(parseGsettingsDoubleClick("'toggle-shade'\n")).toBe(false)
    expect(parseGsettingsDoubleClick('No such schema')).toBeUndefined()
  })
})

describe('the X11 window manager, by its own name', () => {
  it('tells one from before EWMH by its marks on the root window, and a bare display from it', () => {
    expect(parseXpropOlderWm('_MOTIF_WM_INFO = 0x2, 0x1a00005')).toBe(false)
    expect(parseXpropOlderWm('_WIN_SUPPORTING_WM_CHECK = 0x400001\n_WIN_PROTOCOLS = _WIN_LAYER')).toBe(false)
    expect(parseXpropOlderWm('_WINDOWMAKER_WM_PROTOCOLS = _WINDOWMAKER_MENU')).toBe(false)
    expect(parseXpropOlderWm('_NET_SUPPORTED = _NET_WM_NAME, _NET_WM_MOVERESIZE\nRESOURCE_MANAGER = "Xft.dpi: 96"')).toBe(true)
    expect(parseXpropOlderWm('_NET_SUPPORTED = _NET_WM_NAME\n_MOTIF_WM_INFO = 0x2')).toBe(false)
    expect(parseXpropOlderWm('_XKB_RULES_NAMES = "evdev", "pc105", "us", "", ""\nRESOURCE_MANAGER = "_MOTIF_WM_INFO"')).toBeUndefined()
    expect(parseXpropOlderWm('')).toBeUndefined()
  })

  it('reads whether it moves and resizes a window on its asking', () => {
    expect(parseXpropMoves('_NET_SUPPORTED = _NET_SUPPORTED, _NET_WM_NAME, _NET_WM_MOVERESIZE, _NET_ACTIVE_WINDOW')).toBe(true)
    expect(parseXpropMoves('_NET_SUPPORTED(ATOM) = _NET_SUPPORTED, _NET_WM_NAME, _NET_ACTIVE_WINDOW')).toBe(false)
    expect(parseXpropMoves('_NET_SUPPORTED = _NET_WM_MOVERESIZE_CANCEL')).toBe(false)
    expect(parseXpropMoves('_NET_SUPPORTED:  not found.')).toBe(false)
    expect(parseXpropMoves('xprop: unable to open display')).toBeUndefined()
  })

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

  it('draws one bar on every stacking desktop that would frame the window: KDE’s manner on the Qt ones, GNOME’s plain on the rest', () => {
    const kde = { kind: 'drawn', look: 'kde' }
    const plain = { kind: 'drawn', look: 'gnome', tone: 'legacy' }
    expect(wayland('KDE')).toEqual(kde)
    expect(x11('KDE')).toEqual(kde)
    expect(x11('LXQt')).toEqual(kde)
    expect(wayland('LXQt')).toEqual(kde)
    expect(wayland('Deepin')).toEqual(kde)
    for (const desktop of ['XFCE', 'MATE', 'LXDE', 'X-Cinnamon', 'Unity', 'openbox', 'fluxbox', 'icewm'])
      expect(x11(desktop)).toEqual(plain)
    for (const desktop of ['X-Cinnamon', 'COSMIC', 'labwc', 'wayfire', 'XFCE']) expect(wayland(desktop)).toEqual(plain)
    // Wherever KWin runs, its manner.
    expect(on({ XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11' }, { wm: 'kwin' })).toEqual(kde)
  })

  it('keeps the system’s frame only where an X11 window manager can’t move or resize a frameless window', () => {
    expect(on({ XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11' }, { wmMoves: false })).toEqual({ kind: 'frame' })
    expect(on({ XDG_SESSION_TYPE: 'x11' }, { wm: 'evilwm', wmMoves: false })).toEqual({ kind: 'frame' })
    expect(on({ XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11' }, { wmMoves: true })).toMatchObject({ kind: 'drawn' })
    // Every Wayland compositor moves a window on its asking (xdg-shell), and a tiling one has no buttons whatever it says.
    expect(on({ XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland' }, { wmMoves: false })).toMatchObject({ kind: 'drawn' })
    expect(on({ XDG_SESSION_TYPE: 'x11' }, { wm: 'i3', wmMoves: false })).toEqual({ kind: 'bare' })
  })

  it('keeps the system’s frame where the window manager’s double-click was set to do something else than maximize', () => {
    expect(on({ XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland' }, { doubleClickMaximizes: false })).toEqual({ kind: 'frame' })
    expect(on({ XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland' }, { doubleClickMaximizes: true })).toEqual({
      kind: 'drawn',
      look: 'kde',
    })
    expect(on({ XDG_SESSION_TYPE: 'x11' }, { wm: 'i3', doubleClickMaximizes: false })).toEqual({ kind: 'bare' })
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
    expect(on({ XDG_SESSION_TYPE: 'x11' }, { wm: 'openbox' })).toEqual({ kind: 'drawn', look: 'gnome', tone: 'legacy' })
  })

  it('keeps a window’s frame as it opened: framed stays framed, unframed draws its desktop’s buttons', () => {
    const kde = linux({ XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland' })
    expect(decideFor(kde, true)).toEqual({ kind: 'frame' })
    expect(decideFor(kde, false)).toEqual({ kind: 'drawn', look: 'kde' })
    // The X11 window manager's word came after an unframed window opened: it draws its buttons still.
    const xfce = { ...linux({ XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11' }), wmMoves: false }
    expect(decideFor(xfce, false)).toEqual({ kind: 'drawn', look: 'gnome', tone: 'legacy' })
    const gnome = linux({ XDG_CURRENT_DESKTOP: 'GNOME', XDG_SESSION_TYPE: 'wayland' })
    expect(decideFor(gnome, false)).toEqual({ kind: 'drawn', look: 'gnome', tone: 'adwaita' })
  })
})

describe('where the buttons go out of the box', () => {
  const right = { start: [], end: ['minimize', 'maximize', 'close'] }

  it('puts them where each desktop does: GNOME close alone on the right, Pantheon close left and maximize right, Unity all left', () => {
    expect(defaultLayout('gnome')).toEqual({ start: [], end: ['close'] })
    expect(defaultLayout('pantheon')).toEqual({ start: ['close'], end: ['maximize'] })
    expect(defaultLayout('unity')).toEqual({ start: ['close', 'minimize', 'maximize'], end: [] })
    expect(defaultLayout('mac')).toEqual({ start: ['close', 'minimize', 'maximize'], end: [] })
  })

  it('puts minimize, maximize and close on the right on KDE and every other desktop that does, and one it doesn’t know', () => {
    for (const family of ['kde', 'xfce', 'mate', 'cinnamon', 'budgie', 'cosmic', 'lxqt', 'lxde', 'deepin', 'unknown', 'windows'] as const) {
      expect(defaultLayout(family)).toEqual(right)
    }
  })

  it('reads each desktop’s layout where its window manager keeps it', () => {
    const where = (desktop: string, session: string, more: Partial<DesktopFacts> = {}) =>
      layoutSource({ ...linux({ XDG_CURRENT_DESKTOP: desktop, XDG_SESSION_TYPE: session }), ...more })
    expect(where('GNOME', 'wayland')).toBe('gnome')
    expect(where('Budgie:GNOME', 'x11')).toBe('gnome')
    expect(where('Pantheon', 'wayland')).toBe('gnome')
    expect(where('Unity', 'x11')).toBe('gnome')
    expect(where('KDE', 'wayland')).toBe('kwin')
    expect(where('X-Cinnamon', 'x11')).toBe('cinnamon')
    expect(where('MATE', 'x11')).toBe('marco')
    expect(where('XFCE', 'x11')).toBe('xfwm4')
    expect(where('LXDE', 'x11')).toBe('openbox')
    expect(where('LXQt', 'x11')).toBe('openbox')
    expect(where('COSMIC', 'wayland')).toBe('cosmic')
    expect(where('labwc', 'wayland')).toBe('labwc')
    expect(where('wayfire', 'wayland')).toBe('wayfire')
    // The window manager, where something names it, over the desktop's own: LXQt on KWin, Xfce on Mutter.
    expect(where('LXQt', 'x11', { wm: 'kwin' })).toBe('kwin')
    expect(where('XFCE', 'x11', { wm: 'mutter' })).toBe('gnome')
    // Where it isn't known or read: the default stands.
    expect(where('LXQt', 'wayland')).toBeUndefined()
    expect(where('Deepin', 'wayland')).toBeUndefined()
    expect(where('Foo', 'wayland')).toBeUndefined()
    expect(layoutSource(factsFromEnv('win32', {}))).toBeUndefined()
  })
})

describe('each desktop’s own layout, as its window manager keeps it', () => {
  it('reads Xfwm4’s letters from its xfconf file, the title’s bar between the sides', () => {
    const file = (value: string) =>
      `<?xml version="1.0"?>\n<channel name="xfwm4" version="1.0">\n  <property name="general" type="empty">\n    <property name="button_layout" type="string" value="${value}"/>\n  </property>\n</channel>\n`
    expect(parseXfwmLayout(file('O|HMC'))).toEqual({ start: [], end: ['minimize', 'maximize', 'close'] })
    expect(parseXfwmLayout(file('CHM|O'))).toEqual({ start: ['close', 'minimize', 'maximize'], end: [] })
    expect(parseXfwmLayout(file('C|STHM'))).toEqual({ start: ['close'], end: ['minimize', 'maximize'] })
    expect(parseXfwmLayout('<channel name="xfwm4"/>')).toBeUndefined()
    expect(parseXfwmLayout(file('O|H|C'))).toBeUndefined()
    expect(parseXfwmLayout(file('<script>'))).toBeUndefined()
  })

  it('reads Openbox’s titleLayout, the label between the sides', () => {
    const rc = (layout: string) =>
      `<openbox_config><theme><name>Clearlooks</name><titleLayout>${layout}</titleLayout></theme></openbox_config>`
    expect(parseOpenboxLayout(rc('NLIMC'))).toEqual({ start: [], end: ['minimize', 'maximize', 'close'] })
    expect(parseOpenboxLayout(rc('CIMLN'))).toEqual({ start: ['close', 'minimize', 'maximize'], end: [] })
    expect(parseOpenboxLayout(rc('CMI'))).toEqual({ start: ['close', 'maximize', 'minimize'], end: [] })
    expect(parseOpenboxLayout('<openbox_config/>')).toBeUndefined()
    expect(parseOpenboxLayout(rc('N L C'))).toBeUndefined()
  })

  it('reads labwc’s titlebar layout, in GNOME’s form with its own names', () => {
    const rc = (layout: string) => `<labwc_config><theme><titlebar>\n<layout>${layout}</layout>\n</titlebar></theme></labwc_config>`
    expect(parseLabwcLayout(rc('icon:iconify,max,close'))).toEqual({ start: [], end: ['minimize', 'maximize', 'close'] })
    expect(parseLabwcLayout(rc('close,iconify:max'))).toEqual({ start: ['close', 'minimize'], end: ['maximize'] })
    expect(parseLabwcLayout('<labwc_config><theme/></labwc_config>')).toBeUndefined()
    expect(parseLabwcLayout(rc('close;max'))).toBeUndefined()
  })

  it('reads Wayfire’s button order, all on the right', () => {
    expect(wayfireLayout([parseIni('[decoration]\nbutton_order = close maximize\n')])).toEqual({ start: [], end: ['close', 'maximize'] })
    expect(wayfireLayout([parseIni('[core]\nplugins = decoration\n')])).toBeUndefined()
  })

  it('reads COSMIC’s shown buttons, close always and last', () => {
    expect(cosmicLayout('true', 'true')).toEqual({ start: [], end: ['minimize', 'maximize', 'close'] })
    expect(cosmicLayout('false\n', undefined)).toEqual({ start: [], end: ['maximize', 'close'] })
    expect(cosmicLayout(undefined, 'false')).toEqual({ start: [], end: ['minimize', 'close'] })
    expect(cosmicLayout(undefined, undefined)).toBeUndefined()
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
