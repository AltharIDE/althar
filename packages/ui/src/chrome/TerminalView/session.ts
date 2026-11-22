import { FitAddon } from '@xterm/addon-fit'
import { type ISearchOptions, SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { type ITheme, Terminal } from '@xterm/xterm'

import { platform } from '../../foundations/device'

/*
 * One terminal as the window draws it: xterm.js, the terminal an editor
 * draws, in the kit's own colours and type, kept while the terminal is open
 * so it moves between places (the drawer, another project and back) without
 * drawing again from nothing. Its keys are an editor's: copy and paste, select
 * all, clear, find, a word and a line at a time on a Mac; links open with the
 * primary key held; a file dropped on it types its path. What is typed goes
 * to `onData`, its size in characters to `onResize`; nothing else of it is
 * the window's business. What it prints never reaches the clipboard (no OSC
 * 52): copy is the person's selection, paste the Edit menu's.
 */

export interface TerminalSessionOptions {
  /** What was typed or pasted, as the keys send it. */
  readonly onData: (data: string) => void
  /** Its size in characters, as it is first drawn and each time it changes. */
  readonly onResize: (cols: number, rows: number) => void
  /** A link pressed with the primary key held. */
  readonly onLink?: (url: string) => void
  /** Pastes what is on the clipboard where the focus is, as the Edit menu does; without it, the page reads the clipboard itself. */
  readonly onPaste?: () => void
  /** A dropped file's path on disk; without it, nothing is typed for a dropped file. */
  readonly pathOf?: (file: File) => string
  /** The system's keys: darwin, win32, linux. */
  readonly platform?: string
}

export interface FindOptions {
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
  readonly regex: boolean
}

export interface FindResults {
  /** Which one is chosen, from 0; -1 for none. */
  readonly index: number
  readonly count: number
}

/** The ANSI colours, by xterm's names, from the kit's tokens. */
const ANSI = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

const token = (style: CSSStyleDeclaration, name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** Its colours, as the appearance it is drawn in has them. */
export const themeOf = (element: Element): ITheme => {
  const style = getComputedStyle(element)
  const theme: Record<string, string> = {
    background: token(style, '--terminal-paper', '#ffffff'),
    foreground: token(style, '--t-1', '#141417'),
    cursor: token(style, '--t-1', '#141417'),
    cursorAccent: token(style, '--terminal-paper', '#ffffff'),
    selectionBackground: token(style, '--terminal-selection', 'rgba(122, 63, 240, 0.22)'),
    selectionInactiveBackground: token(style, '--terminal-selection-away', 'rgba(20, 20, 28, 0.1)'),
    scrollbarSliderBackground: token(style, '--line-2', 'rgba(20, 20, 28, 0.11)'),
    scrollbarSliderHoverBackground: token(style, '--line-3', 'rgba(20, 20, 28, 0.18)'),
    scrollbarSliderActiveBackground: token(style, '--line-3', 'rgba(20, 20, 28, 0.18)'),
    overviewRulerBorder: 'transparent',
  }
  for (const name of ANSI) theme[name] = token(style, `--ansi-${kebab(name)}`, theme.foreground ?? '#141417')
  return theme as ITheme
}

/** What a pressed key sends where the shell needs an editor's own keys on a Mac; undefined for what xterm sends itself. */
export const macKeyOf = (event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey'>): string | undefined => {
  if (event.ctrlKey || event.shiftKey) return undefined
  if (event.metaKey && !event.altKey) {
    if (event.key === 'ArrowLeft') return '\x01'
    if (event.key === 'ArrowRight') return '\x05'
    if (event.key === 'Backspace') return '\x15'
  }
  if (event.altKey && !event.metaKey) {
    if (event.key === 'ArrowLeft') return '\x1bb'
    if (event.key === 'ArrowRight') return '\x1bf'
    if (event.key === 'Backspace') return '\x1b\x7f'
  }
  return undefined
}

/** A path as a shell reads it, typed for a dropped file: quoted where it has anything a shell would split or expand. */
export const quotedPath = (path: string, system: string = platform) => {
  if (system === 'win32') return /^[\w@%+=:,./\\-]+$/.test(path) ? path : `"${path}"`
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`
}

/** The shortcuts the terminal answers itself, rather than sending them to the shell. */
export type TerminalAction = 'copy' | 'paste' | 'selectAll' | 'clear' | 'find'

/** Which of them a key is, on the system's keys; undefined for a key the shell gets. */
export const actionOf = (
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey'>,
  system: string,
  selected: boolean,
): TerminalAction | undefined => {
  const key = event.key.toLowerCase()
  if (event.altKey) return undefined
  if (system === 'darwin') {
    if (!event.metaKey || event.ctrlKey || event.shiftKey) return undefined
    return key === 'c'
      ? selected
        ? 'copy'
        : undefined
      : key === 'a'
        ? 'selectAll'
        : key === 'k'
          ? 'clear'
          : key === 'f'
            ? 'find'
            : undefined
  }
  if (!event.ctrlKey || event.metaKey) return undefined
  if (event.shiftKey) return key === 'c' ? 'copy' : key === 'v' ? 'paste' : key === 'a' ? 'selectAll' : key === 'f' ? 'find' : undefined
  // On Windows, as in its own terminal: Ctrl+C copies what is chosen, else interrupts; Ctrl+V pastes.
  if (system === 'win32') return key === 'c' && selected ? 'copy' : key === 'v' ? 'paste' : undefined
  return undefined
}

export class TerminalSession {
  readonly element: HTMLDivElement
  readonly term: Terminal
  private readonly fitter = new FitAddon()
  private readonly search = new SearchAddon({ highlightLimit: 2_000 })
  private readonly options: TerminalSessionOptions
  private readonly system: string
  private webgl: WebglAddon | undefined
  /** It was put in the page once: drawn there, or about to be once its type loads. */
  private opened = false
  private disposed = false
  private size = { cols: 0, rows: 0 }
  private themeWatch: MutationObserver | undefined
  private findText = ''
  /** Find was asked for by its key: the view opens its bar. */
  onFind: (() => void) | undefined
  /** How many matches there are, and which is chosen, as they change. */
  onFindResults: ((results: FindResults) => void) | undefined

  constructor(options: TerminalSessionOptions) {
    this.options = options
    this.system = options.platform ?? platform
    this.element = document.createElement('div')
    this.element.className = 'althar-terminal'
    this.term = new Terminal({
      allowProposedApi: true,
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      fontSize: 12.5,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'outline',
      scrollback: 10_000,
      smoothScrollDuration: 0,
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: this.system === 'darwin',
      drawBoldTextInBrightColors: false,
      minimumContrastRatio: 4.5,
      rescaleOverlappingGlyphs: true,
      overviewRuler: { width: 8 },
    })
    this.term.loadAddon(this.fitter)
    this.term.loadAddon(this.search)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(
      new WebLinksAddon((event, url) => {
        if (this.primary(event)) this.options.onLink?.(url)
      }),
    )
    this.term.onData((data) => this.options.onData(data))
    this.term.onResize(({ cols, rows }) => this.resized(cols, rows))
    this.search.onDidChangeResults(({ resultIndex, resultCount }) => this.onFindResults?.({ index: resultIndex, count: resultCount }))
    this.term.attachCustomKeyEventHandler((event) => this.key(event))
    this.element.addEventListener('dragover', (event) => {
      if (this.options.pathOf !== undefined && event.dataTransfer?.types.includes('Files') === true) event.preventDefault()
    })
    this.element.addEventListener('drop', (event) => {
      const pathOf = this.options.pathOf
      const files = [...(event.dataTransfer?.files ?? [])]
      if (pathOf === undefined || files.length === 0) return
      event.preventDefault()
      const paths = files.map((file) => pathOf(file)).filter((path) => path !== '')
      if (paths.length > 0) this.term.paste(`${paths.map((path) => quotedPath(path, this.system)).join(' ')} `)
      this.term.focus()
    })
  }

  private primary(event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>) {
    return this.system === 'darwin' ? event.metaKey : event.ctrlKey
  }

  private resized(cols: number, rows: number) {
    if (cols === this.size.cols && rows === this.size.rows) return
    this.size = { cols, rows }
    this.options.onResize(cols, rows)
  }

  /** Its own keys, and an editor's; false keeps a key from the shell. The window's own toggle, Ctrl+`, passes it by. */
  private key(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true
    if (event.ctrlKey && event.key === '`') return false
    const action = actionOf(event, this.system, this.term.hasSelection())
    if (action !== undefined) {
      // On a Mac, ⌘V is the Edit menu's, which pastes into the terminal itself.
      event.preventDefault()
      this.act(action)
      return false
    }
    if (this.system === 'darwin') {
      const sent = macKeyOf(event)
      if (sent !== undefined) {
        event.preventDefault()
        this.options.onData(sent)
        return false
      }
      // ⌘ with anything else is the window's (⌘W, ⌘1, ⌘,): never the shell's.
      if (event.metaKey) return false
    }
    return true
  }

  /** Does what a shortcut or the terminal's menu asks. */
  act(action: TerminalAction) {
    switch (action) {
      case 'copy': {
        const chosen = this.term.getSelection()
        if (chosen !== '') void navigator.clipboard?.writeText(chosen)
        break
      }
      case 'paste':
        this.term.focus()
        if (this.options.onPaste !== undefined) this.options.onPaste()
        else void navigator.clipboard?.readText().then((text) => this.term.paste(text))
        break
      case 'selectAll':
        this.term.selectAll()
        break
      case 'clear':
        this.term.clear()
        break
      case 'find':
        this.onFind?.()
        break
    }
  }

  /** Puts it in `host` and draws it there: first here, or moved from elsewhere. */
  mount(host: HTMLElement) {
    if (this.disposed) return
    if (this.element.parentElement !== host) host.append(this.element)
    if (this.opened) {
      this.term.refresh(0, this.term.rows - 1)
      this.fit()
      return
    }
    this.opened = true
    // Drawn once its type has loaded, or its cells would be measured at the fallback's width: at once, where it has.
    const font = `${this.term.options.fontSize ?? 12}px 'JetBrains Mono Variable'`
    const fonts = typeof document.fonts === 'undefined' ? undefined : document.fonts
    if (fonts === undefined || fonts.check(font)) this.open()
    else
      void fonts.load(font).then(
        () => this.open(),
        () => this.open(),
      )
  }

  private open() {
    if (this.disposed) return
    try {
      this.term.open(this.element)
    } catch {
      // A page that can't draw (no canvas, as a test's): it stays undrawn, and takes what it is sent all the same.
      return
    }
    this.drawWithGpu()
    this.applyTheme()
    // The theme follows the window's appearance as it changes.
    this.themeWatch = new MutationObserver(() => this.applyTheme())
    this.themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    this.fit()
    this.ready()
  }

  private ready: () => void = () => {}
  /** Once it is drawn, fitted to its place: what waits for its size, or its focus, goes then. */
  readonly drawn = new Promise<void>((resolve) => {
    this.ready = resolve
  })

  /** Takes it out of the page, kept to put back. */
  unmount() {
    this.element.remove()
  }

  /** Drawn on the GPU where it can be, else as the page's own text: a lost context goes back to that. */
  private drawWithGpu() {
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        this.webgl = undefined
      })
      this.term.loadAddon(webgl)
      this.webgl = webgl
    } catch {
      this.webgl = undefined
    }
  }

  private applyTheme() {
    if (this.disposed) return
    this.term.options.theme = themeOf(this.element.isConnected ? this.element : document.documentElement)
  }

  /** Fits it to where it is: as many characters as its place holds. */
  fit() {
    if (this.disposed || this.term.element === undefined || !this.element.isConnected) return
    const { clientWidth, clientHeight } = this.element
    if (clientWidth === 0 || clientHeight === 0) return
    try {
      this.fitter.fit()
    } catch {
      // Not measurable yet; the next resize fits it.
    }
    this.resized(this.term.cols, this.term.rows)
  }

  /** Its size now, in characters, as it was last fitted. */
  get cols() {
    return this.term.cols
  }
  get rows() {
    return this.term.rows
  }

  write(data: string) {
    if (!this.disposed) this.term.write(data)
  }

  /** Takes the keys, once it is drawn. */
  focus() {
    void this.drawn.then(() => this.term.focus())
  }

  /** How a find goes and marks what it found, in the kit's colours. */
  private searchOf(options: FindOptions, incremental: boolean): ISearchOptions {
    const style = getComputedStyle(this.element)
    const match = token(style, '--terminal-match', '#f5e2a0')
    const chosen = token(style, '--terminal-match-chosen', '#e4b53e')
    return {
      ...options,
      incremental,
      decorations: {
        matchBackground: match,
        matchOverviewRuler: match,
        activeMatchBackground: chosen,
        activeMatchColorOverviewRuler: chosen,
      },
    }
  }

  /** Finds `text`, from what is chosen as it is typed; whether it found any. */
  find(text: string, options: FindOptions): boolean {
    this.findText = text
    if (text !== '') return this.search.findNext(text, this.searchOf(options, true))
    this.search.clearDecorations()
    this.onFindResults?.({ index: -1, count: 0 })
    return false
  }

  /** The next match of what was last found, or the one before. */
  findAgain(options: FindOptions, back: boolean): boolean {
    if (this.findText === '') return false
    const search = this.searchOf(options, false)
    return back ? this.search.findPrevious(this.findText, search) : this.search.findNext(this.findText, search)
  }

  /** Finding is over: its marks go. */
  endFind() {
    this.findText = ''
    this.search.clearDecorations()
    this.term.clearSelection()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.themeWatch?.disconnect()
    this.webgl?.dispose()
    this.term.dispose()
    this.element.remove()
  }
}
