/*
 * Which desktop Althar's window sits on, and how its window is dressed for
 * it (ADR-098). The facts come from the environment, the Settings portal,
 * gsettings, the desktop's own config files and, on X11, the window
 * manager's name and what it supports; this file reads none of them itself,
 * it only says what they mean: the desktop and its window manager, and from
 * them whether Althar draws the window's buttons on its own bar, in that
 * desktop's manner, order and side (one bar, everywhere it can be), whether
 * there are none at all (a tiling compositor), or, only where a frameless
 * window couldn't be moved, the window manager's own frame. Nothing here
 * touches Node, so the window may read the types too.
 */

/** Whether the session is Wayland or X11, where it says. */
export type Session = 'wayland' | 'x11' | 'unknown'

/** The desktop, by its family: its forks and remixes count as what they behave like. */
export type Family =
  | 'gnome'
  | 'kde'
  | 'cinnamon'
  | 'mate'
  | 'xfce'
  | 'budgie'
  | 'pantheon'
  | 'cosmic'
  | 'lxqt'
  | 'lxde'
  | 'unity'
  | 'deepin'
  | 'tiling'
  | 'unknown'
  | 'windows'
  | 'mac'

/** One of a window's own buttons. */
export type WindowButton = 'close' | 'minimize' | 'maximize'

/** Which of the window's buttons show at its start (left) and at its end (right), each side in order from left to right. */
export interface ButtonLayout {
  readonly start: readonly WindowButton[]
  readonly end: readonly WindowButton[]
}

/** A colour as the system gives it, each channel 0–255. */
export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** What is known of the desktop. Only `platform`, `session` and `family` are always there; each other fact is missing where it couldn't be read. */
export interface DesktopFacts {
  readonly platform: string
  readonly session: Session
  readonly family: Family
  /** The window manager or compositor, lowercased (`kwin`, `mutter`, `xfwm4`, `sway`), where something names it. */
  readonly wm?: string
  /** GNOME Shell's major version, from its D-Bus property. */
  readonly gnomeVersion?: number
  /** Plasma's major version, from KDE_SESSION_VERSION. */
  readonly plasmaVersion?: number
  /** The GTK theme (`org.gnome.desktop.interface gtk-theme`): Adwaita, Yaru, a custom one. */
  readonly gtkTheme?: string
  /** KWin's decoration plugin (`kwinrc [org.kde.kdecoration2] library`): org.kde.breeze, org.kde.oxygen, org.kde.kwin.aurorae. */
  readonly kdeDecoration?: string
  /** KDE's colour scheme (`kdeglobals [General] ColorScheme`). */
  readonly kdeColorScheme?: string
  /** On X11, whether the window manager moves and resizes a window on its asking (`_NET_WM_MOVERESIZE` in `_NET_SUPPORTED`), as a frameless window's drag and edges ask it. */
  readonly wmMoves?: boolean
}

/** How the window is dressed. mac: the system's traffic lights over Althar's bar. frame: the window manager's own title bar, no buttons of Althar's (only where a frameless window couldn't be moved). drawn: Althar's bar draws them. bare: none at all. */
export type ChromeKind = 'mac' | 'frame' | 'drawn' | 'bare'

/** Whose manner drawn buttons follow. */
export type ButtonsLook = 'gnome' | 'kde' | 'windows'

/** A tuning of the GNOME look for a theme: adwaita (GNOME 40 and later: libadwaita's faint discs), legacy (GTK 3 themes, an unknown desktop: no disc at rest), yaru (Ubuntu's theme: an orange close). */
export type ButtonsTone = 'adwaita' | 'legacy' | 'yaru'

export interface ChromeDecision {
  readonly kind: ChromeKind
  /** With kind drawn. */
  readonly look?: ButtonsLook
  readonly tone?: ButtonsTone
}

/** What the window is told of its desktop. */
export interface DesktopChrome extends ChromeDecision {
  readonly family: Family
  /** Which buttons the desktop shows, and where; its own default where its setting can't be read. */
  readonly layout: ButtonLayout
  /** The system's accent colour, where it has one. */
  readonly accent: Rgb | null
}

// ---- the session and the desktop -----------------------------------------------------------------------------------------

type Env = Readonly<Record<string, string | undefined>>

/** Wayland or X11: XDG_SESSION_TYPE where it says, else a Wayland display, else an X display. */
export const sessionOf = (env: Env): Session => {
  const type = (env.XDG_SESSION_TYPE ?? '').trim().toLowerCase()
  if (type === 'wayland') return 'wayland'
  if (type === 'x11') return 'x11'
  if ((env.WAYLAND_DISPLAY ?? '') !== '') return 'wayland'
  if ((env.DISPLAY ?? '') !== '') return 'x11'
  return 'unknown'
}

/** Tiling window managers and compositors: they place every window, and draw no buttons an app should mimic. */
const TILING = new Set([
  'sway',
  'swayfx',
  'hyprland',
  'i3',
  'river',
  'niri',
  'bspwm',
  'dwm',
  'dwl',
  'awesome',
  'qtile',
  'xmonad',
  'herbstluftwm',
  'spectrwm',
  'leftwm',
])

/** A desktop's name as a session gives it, and what it is. */
const DESKTOP_NAMES: Readonly<Record<string, { readonly family: Family; readonly wm?: string }>> = {
  gnome: { family: 'gnome' },
  'gnome-classic': { family: 'gnome' },
  'gnome-xorg': { family: 'gnome' },
  'gnome-wayland': { family: 'gnome' },
  'gnome-flashback': { family: 'gnome', wm: 'metacity' },
  ubuntu: { family: 'gnome' },
  'ubuntu-wayland': { family: 'gnome' },
  'ubuntu-xorg': { family: 'gnome' },
  pop: { family: 'gnome' },
  zorin: { family: 'gnome' },
  kde: { family: 'kde', wm: 'kwin' },
  plasma: { family: 'kde', wm: 'kwin' },
  plasmawayland: { family: 'kde', wm: 'kwin' },
  plasmax11: { family: 'kde', wm: 'kwin' },
  cinnamon: { family: 'cinnamon', wm: 'muffin' },
  'x-cinnamon': { family: 'cinnamon', wm: 'muffin' },
  'cinnamon-wayland': { family: 'cinnamon', wm: 'muffin' },
  mate: { family: 'mate', wm: 'marco' },
  xfce: { family: 'xfce' },
  xfce4: { family: 'xfce' },
  budgie: { family: 'budgie' },
  'budgie-desktop': { family: 'budgie' },
  pantheon: { family: 'pantheon', wm: 'gala' },
  cosmic: { family: 'cosmic', wm: 'cosmic-comp' },
  lxqt: { family: 'lxqt' },
  lxde: { family: 'lxde', wm: 'openbox' },
  unity: { family: 'unity', wm: 'compiz' },
  deepin: { family: 'deepin' },
  dde: { family: 'deepin' },
  openbox: { family: 'unknown', wm: 'openbox' },
  labwc: { family: 'unknown', wm: 'labwc' },
  wayfire: { family: 'unknown', wm: 'wayfire' },
  fluxbox: { family: 'unknown', wm: 'fluxbox' },
  icewm: { family: 'unknown', wm: 'icewm' },
  enlightenment: { family: 'unknown', wm: 'enlightenment' },
}

/** A desktop or window manager by a name a session gives: `KDE`, `X-Cinnamon`, `Hyprland`. */
const named = (raw: string): { readonly family: Family; readonly wm?: string } | undefined => {
  const name = raw.trim().toLowerCase()
  if (name === '') return undefined
  if (TILING.has(name)) return { family: 'tiling', wm: name }
  return Object.hasOwn(DESKTOP_NAMES, name) ? DESKTOP_NAMES[name] : undefined
}

/** Sockets a compositor or window manager leaves in the session, which name it even where the desktop says otherwise (XFCE with i3). */
const WM_SOCKETS: ReadonlyArray<readonly [string, string]> = [
  ['SWAYSOCK', 'sway'],
  ['HYPRLAND_INSTANCE_SIGNATURE', 'hyprland'],
  ['NIRI_SOCKET', 'niri'],
  ['I3SOCK', 'i3'],
]

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/**
 * What the environment says of the desktop: the system, the session, and on Linux the desktop's family and its window manager, from
 * `XDG_CURRENT_DESKTOP` (a list, `ubuntu:GNOME`, read in order), `XDG_SESSION_DESKTOP`, `DESKTOP_SESSION` (which may be a path), KDE's
 * own `KDE_FULL_SESSION` and `KDE_SESSION_VERSION`, and the sockets a tiling compositor leaves, which win over the desktop's name.
 */
export const factsFromEnv = (platform: string, env: Env): DesktopFacts => {
  if (platform === 'darwin') return { platform, session: 'unknown', family: 'mac' }
  if (platform === 'win32') return { platform, session: 'unknown', family: 'windows' }
  const session = sessionOf(env)
  const names = [env.XDG_CURRENT_DESKTOP, env.XDG_SESSION_DESKTOP, env.DESKTOP_SESSION]
    .flatMap((value) => (value ?? '').split(':'))
    // DESKTOP_SESSION may be a path to a session file (/usr/share/xsessions/plasma.desktop).
    .map((name) => (name.split('/').pop() ?? '').replace(/\.desktop$/i, ''))
  let found: { readonly family: Family; readonly wm?: string } | undefined
  for (const name of names) {
    found = named(name)
    if (found !== undefined) break
  }
  const plasma = Number.parseInt(env.KDE_SESSION_VERSION ?? '', 10)
  if (found === undefined && (env.KDE_FULL_SESSION === 'true' || Number.isInteger(plasma))) found = { family: 'kde', wm: 'kwin' }
  if (found === undefined && (env.GNOME_SHELL_SESSION_MODE ?? '') !== '') found = { family: 'gnome' }
  const socket = WM_SOCKETS.find(([key]) => (env[key] ?? '') !== '')
  const facts: Mutable<DesktopFacts> = { platform, session, family: socket === undefined ? (found?.family ?? 'unknown') : 'tiling' }
  const wm = socket === undefined ? found?.wm : socket[1]
  if (wm !== undefined) facts.wm = wm
  if (facts.family === 'kde' && Number.isInteger(plasma) && plasma > 0 && plasma < 100) facts.plasmaVersion = plasma
  return facts
}

/** An X11 window manager by its own name (`_NET_WM_NAME`): `Xfwm4`, `KWin`, `Mutter (Muffin)`, `GNOME Shell`, `i3`. */
export const wmFromName = (raw: string): string | undefined => {
  const name = raw.trim().toLowerCase()
  if (name === '') return undefined
  if (name.includes('muffin')) return 'muffin'
  if (name === 'gnome shell' || name.startsWith('mutter')) return 'mutter'
  if (name.startsWith('kwin')) return 'kwin'
  if (name.startsWith('xfwm')) return 'xfwm4'
  const plain = name.replace(/[^a-z0-9_.-]/g, '').slice(0, 40)
  return plain === '' ? undefined : plain
}

/** Facts read later, laid over what the environment said: what a later read names wins; what it couldn't read leaves the fact as it was. */
export const withFacts = (facts: DesktopFacts, more: Partial<Omit<DesktopFacts, 'platform' | 'session'>>): DesktopFacts => {
  const next: Record<string, unknown> = { ...facts }
  for (const [key, value] of Object.entries(more)) if (value !== undefined) next[key] = value
  const merged = next as unknown as DesktopFacts
  // A tiling window manager makes the session a tiling one, whatever the desktop's name.
  return merged.wm !== undefined && TILING.has(merged.wm) ? { ...merged, family: 'tiling' } : merged
}

// ---- the decision ---------------------------------------------------------------------------------------------------------

/** The GNOME look's tuning: Yaru's orange close wherever Yaru is the theme; libadwaita's discs on GNOME 40 and later, or where the version is unknown; GTK 3's plain buttons elsewhere. */
const toneFor = (facts: DesktopFacts): ButtonsTone => {
  if (facts.gtkTheme !== undefined && /^yaru/i.test(facts.gtkTheme)) return 'yaru'
  if (facts.family !== 'gnome') return 'legacy'
  return facts.gnomeVersion !== undefined && facts.gnomeVersion < 40 ? 'legacy' : 'adwaita'
}

/** The Qt desktops, whose window managers draw KDE's manner of buttons (KWin, Deepin's KWin, LXQt's usual ones). */
const QT_FAMILIES: ReadonlySet<Family> = new Set(['kde', 'lxqt', 'deepin'])

/** The buttons Althar draws on a Linux desktop: KDE's manner for the Qt desktops and wherever KWin runs, GNOME's (tuned for the theme) for the rest. */
export const drawnFor = (facts: DesktopFacts): ChromeDecision =>
  QT_FAMILIES.has(facts.family) || facts.wm === 'kwin' || facts.wm === 'deepin-kwin'
    ? { kind: 'drawn', look: 'kde' }
    : { kind: 'drawn', look: 'gnome', tone: toneFor(facts) }

/**
 * How the window is dressed on this desktop (ADR-098's table): one bar, Althar's, on every Linux desktop that allows it.
 * - a Mac: the system's traffic lights; Windows: Althar's caption buttons, in Windows' manner.
 * - a tiling compositor or window manager: no buttons at all.
 * - an X11 window manager known not to move or resize a window on its asking (no `_NET_WM_MOVERESIZE`): the system's frame,
 *   since a frameless window could be neither dragged nor resized there.
 * - every other Linux desktop, stacking window managers that would draw a frame of their own (KWin, xfwm4, Marco, Openbox,
 *   Muffin, labwc, COSMIC's) included: Althar draws the window's buttons in that desktop's manner on its own bar.
 */
export const decideChrome = (facts: DesktopFacts): ChromeDecision => {
  if (facts.family === 'mac') return { kind: 'mac' }
  if (facts.family === 'windows') return { kind: 'drawn', look: 'windows' }
  if (facts.family === 'tiling' || (facts.wm !== undefined && TILING.has(facts.wm))) return { kind: 'bare' }
  if (facts.session !== 'wayland' && facts.wmMoves === false) return { kind: 'frame' }
  return drawnFor(facts)
}

/**
 * The decision for a window that already has, or hasn't, the system's frame: the frame can't be put on or taken off a window
 * once it is open, so where what is now known says otherwise (the X11 window manager's word came after the window opened), a
 * framed window keeps its frame and draws nothing, and an unframed one draws its desktop's buttons.
 */
export const decideFor = (facts: DesktopFacts, framed: boolean): ChromeDecision => {
  if (framed) return { kind: 'frame' }
  const decision = decideChrome(facts)
  return decision.kind === 'frame' ? drawnFor(facts) : decision
}

/** Where a desktop keeps its window buttons' layout, by the window manager that reads it. */
export type LayoutSource = 'gnome' | 'kwin' | 'cinnamon' | 'marco' | 'xfwm4' | 'openbox' | 'labwc' | 'wayfire' | 'cosmic'

/** Window managers by where their layout is kept: GNOME's key for Mutter and those built on or beside it. */
const WM_SOURCES: Readonly<Record<string, LayoutSource>> = {
  mutter: 'gnome',
  gala: 'gnome',
  'budgie-wm': 'gnome',
  metacity: 'gnome',
  compiz: 'gnome',
  kwin: 'kwin',
  muffin: 'cinnamon',
  marco: 'marco',
  xfwm4: 'xfwm4',
  openbox: 'openbox',
  labwc: 'labwc',
  wayfire: 'wayfire',
  'cosmic-comp': 'cosmic',
}

/** Desktops by where their layout is kept, where nothing names the window manager: their own one's. */
const FAMILY_SOURCES: Readonly<Partial<Record<Family, LayoutSource>>> = {
  gnome: 'gnome',
  budgie: 'gnome',
  pantheon: 'gnome',
  unity: 'gnome',
  kde: 'kwin',
  cinnamon: 'cinnamon',
  mate: 'marco',
  xfce: 'xfwm4',
  lxde: 'openbox',
  cosmic: 'cosmic',
}

/**
 * Where this desktop's own button layout is read from: its window manager's, where something named it, else its desktop's own
 * one's. LXQt's is Openbox on X11 and unsaid on Wayland, where it runs on several; Deepin's isn't read. Nothing on a Mac or Windows.
 */
export const layoutSource = (facts: DesktopFacts): LayoutSource | undefined => {
  if (facts.platform !== 'linux') return undefined
  if (facts.wm !== undefined && Object.hasOwn(WM_SOURCES, facts.wm)) return WM_SOURCES[facts.wm]
  if (facts.family === 'lxqt') return facts.session === 'wayland' ? undefined : 'openbox'
  return FAMILY_SOURCES[facts.family]
}

const RIGHT: ButtonLayout = { start: [], end: ['minimize', 'maximize', 'close'] }

/**
 * Where each desktop puts the window's buttons out of the box, for where its own setting can't be read: GNOME close alone on the
 * right; Pantheon close on the left and maximize on the right; Unity all three on the left, close first; a Mac its lights on the
 * left; and every other one (KDE, Xfce, MATE, Cinnamon, Budgie, COSMIC, Deepin, LXQt, LXDE, Openbox, labwc, Wayfire, Windows,
 * one it doesn't know) minimize, maximize and close on the right.
 */
export const DEFAULT_LAYOUTS: Readonly<Record<Family, ButtonLayout>> = {
  gnome: { start: [], end: ['close'] },
  pantheon: { start: ['close'], end: ['maximize'] },
  unity: { start: ['close', 'minimize', 'maximize'], end: [] },
  mac: { start: ['close', 'minimize', 'maximize'], end: [] },
  kde: RIGHT,
  cinnamon: RIGHT,
  mate: RIGHT,
  xfce: RIGHT,
  budgie: RIGHT,
  cosmic: RIGHT,
  lxqt: RIGHT,
  lxde: RIGHT,
  deepin: RIGHT,
  tiling: RIGHT,
  unknown: RIGHT,
  windows: RIGHT,
}

/** Where each desktop puts the window's buttons out of the box, for where its own setting can't be read (`DEFAULT_LAYOUTS`). */
export const defaultLayout = (family: Family): ButtonLayout => DEFAULT_LAYOUTS[family]

// ---- reading what the desktop's settings say ------------------------------------------------------------------------------

const GNOME_BUTTONS: Readonly<Record<string, WindowButton>> = { close: 'close', minimize: 'minimize', maximize: 'maximize' }

/** Each button once, at the first place it is named: a layout that names one twice draws it once. */
const once = (layout: { start: WindowButton[]; end: WindowButton[] }): ButtonLayout => {
  const seen = new Set<WindowButton>()
  const keep = (button: WindowButton) => {
    if (seen.has(button)) return false
    seen.add(button)
    return true
  }
  const start = layout.start.filter(keep)
  return { start, end: layout.end.filter(keep) }
}

/** The quoted string in what gdbus prints for a read (`(<<'Adwaita'>>,)`) or a change signal (`<'Adwaita'>`); nothing where there is none. */
export const parseQuoted = (text: string): string | undefined => /'([^']*)'/.exec(text)?.[1]

/**
 * GNOME's `org.gnome.desktop.wm.preferences` `button-layout`, as the portal prints it (`(<<'appmenu:close'>>,)`) or bare
 * (`appmenu:minimize,maximize,close`): what is before the colon is on the left, what is after on the right, in the order written;
 * names other than the three buttons (appmenu, menu, icon, spacer) take no place here. Without a colon everything is on the left,
 * as GTK has it. Nothing where it isn't a layout: anything but names, commas and one colon.
 */
export const parseGnomeLayout = (text: string): ButtonLayout | undefined => {
  const value = (parseQuoted(text) ?? text).replace(/\s+/g, '')
  if (!/^[a-z_-]*(?:,[a-z_-]*)*(?::[a-z_-]*(?:,[a-z_-]*)*)?$/.test(value)) return undefined
  const [left = '', right = ''] = value.split(':')
  const buttons = (side: string) =>
    side
      .split(',')
      .map((name) => (Object.hasOwn(GNOME_BUTTONS, name) ? GNOME_BUTTONS[name] : undefined))
      .filter((button): button is WindowButton => button !== undefined)
  return once({ start: buttons(left), end: buttons(right) })
}

const NAME = /^[\w .+@-]{1,80}$/

/** A theme's name as the portal prints it: letters, digits and the usual punctuation, at most 80; nothing for anything else. */
export const parseThemeName = (text: string): string | undefined => {
  const name = parseQuoted(text)?.trim()
  return name !== undefined && NAME.test(name) ? name : undefined
}

/** An INI file of KDE's, as groups of keys. */
export type Ini = ReadonlyMap<string, ReadonlyMap<string, string>>

/** `[Group]` lines, `key=value` lines, `#` and `;` comments, a key's `[$i]` flags dropped, the first of a key kept. Anything else is passed over. */
export const parseIni = (text: string): Ini => {
  const groups = new Map<string, Map<string, string>>()
  let group: Map<string, string> | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
    if (line.startsWith('[')) {
      const name = /^\[([^\]]*)\]/.exec(line)?.[1]
      group = name === undefined ? undefined : (groups.get(name) ?? new Map<string, string>())
      if (name !== undefined && group !== undefined) groups.set(name, group)
      continue
    }
    const at = line.indexOf('=')
    if (group === undefined || at < 1) continue
    const key = line
      .slice(0, at)
      .trim()
      .replace(/\[\$[a-z]+\]$/i, '')
    if (!group.has(key)) group.set(key, line.slice(at + 1).trim())
  }
  return groups
}

/** KDE's cascade: the person's own file first, then each system one; a key is read from the first that has it. */
export const iniValue = (files: readonly Ini[], group: string, key: string): string | undefined => {
  for (const file of files) {
    const value = file.get(group)?.get(key)
    if (value !== undefined) return value
  }
  return undefined
}

const KDE_BUTTONS: Readonly<Record<string, WindowButton>> = { X: 'close', I: 'minimize', A: 'maximize' }

/** KWin's own default, where kwinrc doesn't say: the window menu and on-all-desktops on the left, minimize, maximize and close on the right. */
const KDE_DEFAULT = { left: 'MS', right: 'IAX' } as const

/**
 * KDE's buttons from kwinrc's `[org.kde.kdecoration2]` `ButtonsOnLeft` and `ButtonsOnRight`, through the cascade: a letter each,
 * X close, I minimize, A maximize, and others (M menu, S all desktops, H help, F above, B below, L shade, N app menu, `_` a gap)
 * that take no place here. A side no file names is KWin's default for it.
 */
export const kwinLayout = (files: readonly Ini[]): ButtonLayout => {
  const buttons = (letters: string) =>
    letters
      .split('')
      .map((letter) => (Object.hasOwn(KDE_BUTTONS, letter) ? KDE_BUTTONS[letter] : undefined))
      .filter((button): button is WindowButton => button !== undefined)
  const left = iniValue(files, 'org.kde.kdecoration2', 'ButtonsOnLeft') ?? KDE_DEFAULT.left
  const right = iniValue(files, 'org.kde.kdecoration2', 'ButtonsOnRight') ?? KDE_DEFAULT.right
  return once({ start: buttons(left), end: buttons(right) })
}

/** A name from a KDE file, kept only where it looks like one (`org.kde.breeze`, `BreezeDark`, `__aurorae__svg__Sweet`). */
const kdeName = (value: string | undefined) => (value !== undefined && NAME.test(value) ? value : undefined)

/** What KDE's files say of the window's decoration and colours: KWin's decoration plugin, and the colour scheme. */
export const kdeFacts = (kwinrc: readonly Ini[], kdeglobals: readonly Ini[]): Pick<DesktopFacts, 'kdeDecoration' | 'kdeColorScheme'> => {
  const facts: Mutable<Pick<DesktopFacts, 'kdeDecoration' | 'kdeColorScheme'>> = {}
  const decoration = kdeName(iniValue(kwinrc, 'org.kde.kdecoration2', 'library'))
  const scheme = kdeName(iniValue(kdeglobals, 'General', 'ColorScheme'))
  if (decoration !== undefined) facts.kdeDecoration = decoration
  if (scheme !== undefined) facts.kdeColorScheme = scheme
  return facts
}

/** GNOME Shell's major version from its `ShellVersion` property as gdbus prints it, `(<'46.2'>,)`; nothing for anything else. */
export const parseShellVersion = (text: string): number | undefined => {
  const match = /^(\d{1,3})(?:\.|$)/.exec(parseQuoted(text) ?? '')
  return match === null ? undefined : Number(match[1])
}

/** The window id in `xprop -root _NET_SUPPORTING_WM_CHECK`: `_NET_SUPPORTING_WM_CHECK: window id # 0x1a00003`. */
export const parseXpropWindow = (text: string): string | undefined => /window id # (0x[0-9a-f]{1,8})\b/i.exec(text)?.[1]

/** The name in `xprop -id … _NET_WM_NAME`: `_NET_WM_NAME(UTF8_STRING) = "Xfwm4"`. */
export const parseXpropName = (text: string): string | undefined => /_NET_WM_NAME(?:\(\w+\))?\s*=\s*"([^"]{1,80})"/.exec(text)?.[1]

/**
 * Whether the X11 window manager moves and resizes a window on its asking, from `xprop -root -notype _NET_SUPPORTED`: yes where
 * the list names `_NET_WM_MOVERESIZE`, no where it doesn't or the root has no such list (a window manager from before EWMH, as
 * twm is); nothing where xprop printed something else.
 */
export const parseXpropMoves = (text: string): boolean | undefined => {
  if (/_NET_SUPPORTED:\s+not found/.test(text)) return false
  if (!/_NET_SUPPORTED(?:\(\w+\))?\s*=/.test(text)) return undefined
  return /\b_NET_WM_MOVERESIZE\b/.test(text)
}

/** A layout from names on each side, by a table of names to buttons; names not in it take no place. */
const byNames = (start: readonly string[], end: readonly string[], names: Readonly<Record<string, WindowButton>>): ButtonLayout => {
  const buttons = (side: readonly string[]) =>
    side
      .map((name) => (Object.hasOwn(names, name) ? names[name] : undefined))
      .filter((button): button is WindowButton => button !== undefined)
  return once({ start: buttons(start), end: buttons(end) })
}

/** Xfwm4's layout: its letters and one bar (the title), short. */
const LETTERS = /^[A-Za-z|_ ]{0,20}$/

/**
 * Xfwm4's `button_layout`, from its xfconf channel's file (`xfwm4.xml`, `<property name="button_layout" type="string" value="O|HMC"/>`):
 * a letter each, H minimize (hide), M maximize, C close, and others (O menu, T stick, S shade) that take no place here; what is
 * before the bar (the title) is on the left. Nothing where the file doesn't say, or says something that isn't a layout.
 */
export const parseXfwmLayout = (xml: string): ButtonLayout | undefined => {
  const value = /<property\s+name="button_layout"\s+type="string"\s+value="([^"]*)"/.exec(xml)?.[1]
  if (value === undefined || !LETTERS.test(value) || (value.match(/\|/g)?.length ?? 0) > 1) return undefined
  const [left = '', right = ''] = value.split('|')
  return byNames(left.split(''), right.split(''), { H: 'minimize', M: 'maximize', C: 'close' })
}

/**
 * Openbox's `<titleLayout>` (`NLIMC`), from its rc file: a letter each, I minimize (iconify), M maximize, C close, and others
 * (N icon, D all desktops, S shade) that take no place here; what is before L (the title) is on the left, and without an L all are.
 */
export const parseOpenboxLayout = (xml: string): ButtonLayout | undefined => {
  const value = /<titleLayout>\s*([^<]*?)\s*<\/titleLayout>/.exec(xml)?.[1]
  if (value === undefined || !/^[A-Za-z]{0,12}$/.test(value)) return undefined
  const at = value.toUpperCase().indexOf('L')
  const letters = value.toUpperCase().split('')
  const names = { I: 'minimize', M: 'maximize', C: 'close' } as const
  return at < 0 ? byNames(letters, [], names) : byNames(letters.slice(0, at), letters.slice(at + 1), names)
}

/**
 * labwc's `<titlebar><layout>` (`icon:iconify,max,close`), from its rc file: GNOME's form, iconify minimize, max maximize, close,
 * and others (icon, menu, shade, desk) that take no place here. Nothing where the file doesn't say.
 */
export const parseLabwcLayout = (xml: string): ButtonLayout | undefined => {
  const value = /<titlebar>[\s\S]*?<layout>\s*([^<]*?)\s*<\/layout>/.exec(xml)?.[1]?.replace(/\s+/g, '')
  if (value === undefined || !/^[a-z_-]*(?:,[a-z_-]*)*(?::[a-z_-]*(?:,[a-z_-]*)*)?$/.test(value)) return undefined
  const [left = '', right = ''] = value.split(':')
  return byNames(left.split(','), right.split(','), { iconify: 'minimize', max: 'maximize', close: 'close' })
}

/** Wayfire's `[decoration] button_order` (`minimize maximize close`), from wayfire.ini: all on the right, in the order written. */
export const wayfireLayout = (files: readonly Ini[]): ButtonLayout | undefined => {
  const value = iniValue(files, 'decoration', 'button_order')
  if (value === undefined) return undefined
  return byNames([], value.trim().split(/\s+/), GNOME_BUTTONS)
}

/**
 * COSMIC's buttons, from its toolkit's `show_minimize` and `show_maximize` (`~/.config/cosmic/com.system76.CosmicTk/v1/`, each
 * `true` or `false`): each shown unless it says false, with close always, all on the right. Nothing where neither file says.
 */
export const cosmicLayout = (minimize: string | undefined, maximize: string | undefined): ButtonLayout | undefined => {
  if (minimize === undefined && maximize === undefined) return undefined
  const shown = (text: string | undefined) => text?.trim() !== 'false'
  const end: WindowButton[] = [
    ...(shown(minimize) ? ['minimize' as const] : []),
    ...(shown(maximize) ? ['maximize' as const] : []),
    'close',
  ]
  return { start: [], end }
}

/**
 * The portal's `org.freedesktop.appearance` `accent-color`, as gdbus prints it (`(<<(0.21, 0.52, 0.89)>>,)`, or the change signal's
 * `<(0.21, 0.52, 0.89)>`): three channels from 0 to 1. A channel outside that range is the portal saying there is none.
 */
export const parsePortalAccent = (text: string): Rgb | null | undefined => {
  const match = /\(\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*,\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*,\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*\)/i.exec(text)
  if (match === null) return undefined
  const channels = [match[1], match[2], match[3]].map(Number)
  if (channels.some((c) => !Number.isFinite(c))) return undefined
  if (channels.some((c) => c < 0 || c > 1)) return null
  const [r = 0, g = 0, b = 0] = channels.map((c) => Math.round(c * 255))
  return { r, g, b }
}

/** Electron's `systemPreferences.getAccentColor()`, `RRGGBBAA` (or `RRGGBB`), as a colour; nothing for anything else. */
export const parseHexAccent = (hex: string): Rgb | null => {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(hex.trim())
  if (match === null) return null
  return { r: Number.parseInt(match[1] ?? '0', 16), g: Number.parseInt(match[2] ?? '0', 16), b: Number.parseInt(match[3] ?? '0', 16) }
}

// ---- handing it to the window ---------------------------------------------------------------------------------------------

/** The argument main hands each window with what it knows of the desktop as the window opens, so its first frame draws its buttons where they go. */
export const CHROME_ARG = '--althar-chrome='

/** What a window was handed in `CHROME_ARG`, checked: nothing where it is missing or isn't one. */
export const chromeFromArgs = (argv: readonly string[]): DesktopChrome | undefined => {
  const arg = argv.find((one) => one.startsWith(CHROME_ARG))
  if (arg === undefined) return undefined
  try {
    const value: unknown = JSON.parse(arg.slice(CHROME_ARG.length))
    return isDesktopChrome(value) ? value : undefined
  } catch {
    return undefined
  }
}

const FAMILIES: readonly string[] = [
  'gnome',
  'kde',
  'cinnamon',
  'mate',
  'xfce',
  'budgie',
  'pantheon',
  'cosmic',
  'lxqt',
  'lxde',
  'unity',
  'deepin',
  'tiling',
  'unknown',
  'windows',
  'mac',
]
const KINDS: readonly string[] = ['mac', 'frame', 'drawn', 'bare']
const LOOKS: readonly string[] = ['gnome', 'kde', 'windows']
const TONES: readonly string[] = ['adwaita', 'legacy', 'yaru']
const BUTTONS: readonly string[] = ['close', 'minimize', 'maximize']

const isButtons = (value: unknown): value is WindowButton[] =>
  Array.isArray(value) && value.every((one) => typeof one === 'string' && BUTTONS.includes(one))

const isChannel = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255

const isOneOf = (value: unknown, of: readonly string[]) => typeof value === 'string' && of.includes(value)

/** Whether `value` is a DesktopChrome, as it crosses from main to the window. */
export const isDesktopChrome = (value: unknown): value is DesktopChrome => {
  if (typeof value !== 'object' || value === null) return false
  const { family, kind, look, tone, layout, accent } = value as Record<string, unknown>
  if (!isOneOf(family, FAMILIES) || !isOneOf(kind, KINDS)) return false
  if (look !== undefined && !isOneOf(look, LOOKS)) return false
  if (tone !== undefined && !isOneOf(tone, TONES)) return false
  if (typeof layout !== 'object' || layout === null) return false
  const { start, end } = layout as Record<string, unknown>
  if (!isButtons(start) || !isButtons(end)) return false
  if (accent === null) return true
  if (typeof accent !== 'object' || accent === undefined) return false
  const { r, g, b } = accent as Record<string, unknown>
  return isChannel(r) && isChannel(g) && isChannel(b)
}
