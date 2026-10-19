import {
  createContext,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandChip } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Popover } from '../../primitives/Popover/Popover'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './ControlCenter.module.css'

/*
 * Settings as a panel from the window's bar, the way the Mac's Control Center
 * opens from its menu bar, over whatever the person was looking at. Modules
 * say where each thing stands at a glance, each as large as it matters, set
 * in a grid of columns and rows; what changes often is one press on a round
 * switch; what matters least is a quiet link in the foot. Any of them opens
 * out in place (ControlDetail) and steps back. The panel grows to fit what is
 * open in it, as wide as the consumer says, down to a card for one thing done
 * a step at a time. It is a Popover: Escape and a press outside close it,
 * unless it is `holding` something under way, like a sign-in the person is
 * finishing in their browser.
 *
 * Focus follows what is open: into an opened module's way back, and back to
 * the module or link it came from, so a keyboard carries on where it was.
 */

export interface ControlCenterText {
  label: string
}

export const controlCenterText: ControlCenterText = { label: 'Settings' }

export interface ControlCenterProps {
  /** The button in the bar that opens it. It must accept a ref and spread its props onto a button. */
  trigger: ReactElement
  /** What is open in it: a ControlGrid of modules, or a ControlDetail. */
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * How wide it is, in px, for what is open in it: 440 at rest; a card, a
   * little wider at 480, for one thing done a step at a time; or opened out,
   * for a part that needs the room.
   */
  width?: number
  /** Something in it is under way: a press outside doesn't close it. Escape still does, through `onEscapeKeyDown`. */
  holding?: boolean
  /** Escape, before it closes: prevent the default to step back out of an opened module instead. */
  onEscapeKeyDown?: (e: KeyboardEvent) => void
  className?: string
  text?: Partial<ControlCenterText>
}

/** Settings, as a panel from the window's bar: modules at a glance, each opening out in place. */
export function ControlCenter({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  width = 440,
  holding = false,
  onEscapeKeyDown,
  className,
  text,
}: ControlCenterProps) {
  const t = { ...controlCenterText, ...text }
  const opened = useOpening()
  return (
    <Popover
      trigger={trigger}
      label={t.label}
      align="end"
      width={width}
      padded={false}
      initialFocus="panel"
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      onEscapeKeyDown={onEscapeKeyDown}
      onInteractOutside={holding ? (e) => e.preventDefault() : undefined}
      className={cx(s.panel, className)}
    >
      <Opened.Provider value={opened}>
        <Fit>{children}</Fit>
      </Opened.Provider>
    </Popover>
  )
}

/* The module last opened out, by its title: it takes focus again when the
   person steps back to all of them. */
interface Opening {
  /** A module opens out. */
  mark: (title: string) => void
  /** Whether this module is the one stepped back from; asking clears it. */
  take: (title: string) => boolean
}
const Opened = createContext<Opening | null>(null)

function useOpening(): Opening {
  const last = useRef<string | null>(null)
  return useMemo(
    () => ({
      mark: (title) => {
        last.current = title
      },
      take: (title) => {
        if (last.current !== title) return false
        last.current = null
        return true
      },
    }),
    [],
  )
}

/* Focus went with what was open, onto the page's body. */
const focusLost = () => document.activeElement === null || document.activeElement === document.body

/* Hands an element to the consumer's ref as well as a part's own. */
const assign = <T,>(ref: Ref<T> | undefined, node: T | null) => {
  if (typeof ref === 'function') ref(node)
  else if (ref) ref.current = node
}

/* A part that opens out, remembered by its title: it marks itself as it opens, and takes focus again
   as it comes back, when the person steps back to all of them and focus went with what was open. */
function useRemembered<T extends HTMLElement>(title: string, forwarded?: Ref<T>) {
  const opened = useContext(Opened)
  const attach = useCallback(
    (node: T | null) => {
      assign(forwarded, node)
      if (node !== null && opened?.take(title) && focusLost()) node.focus()
    },
    [opened, title, forwarded],
  )
  const mark = useCallback(() => opened?.mark(title), [opened, title])
  return [attach, mark] as const
}

/* What is open, at its own height: the panel follows it, so it moves from one
   to the next rather than jumping. */
function Fit({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const element = inner.current
    if (element === null) return
    const measure = () => setHeight(element.offsetHeight)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [])
  return (
    <div className={s.fit} style={height === undefined ? undefined : { height }}>
      <div ref={inner} className={s.inner}>
        {children}
      </div>
    </div>
  )
}

/* ---- the modules ------------------------------------------------------------------ */

/** Where a part sits in a ControlGrid: the grid lines it runs between, across and down. */
export interface ControlPlace {
  /** Columns, from one line to another: [1, 3] is the first two. */
  column: readonly [number, number]
  /** Rows, likewise, in the grid's row unit. Without them, it takes the next row free. */
  row?: readonly [number, number]
}

const placed = (place: ControlPlace | undefined, style?: CSSProperties): CSSProperties | undefined =>
  place === undefined
    ? style
    : {
        ...style,
        gridColumn: `${place.column[0]} / ${place.column[1]}`,
        ...(place.row === undefined ? {} : { gridRow: `${place.row[0]} / ${place.row[1]}` }),
      }

export type ControlGridProps = RootProps<
  'div',
  {
    children: ReactNode
    /** How many columns across. */
    columns?: number
    /** How tall a row is, in px, for parts placed by rows: a round switch is two of 28, a large module six. Without it, each row is as tall as what is in it. */
    row?: number
  }
>

/** The modules, in columns of equal width; each sits where its `place` says, a module across them all and a switch across half without one. */
export function ControlGrid({ children, columns = 4, row, className, style, ...rest }: ControlGridProps) {
  const grid = { ...style, '--columns': columns, ...(row === undefined ? {} : { '--row': `${row}px` }) } as CSSProperties
  return (
    <div className={cx(s.grid, className)} style={grid} {...rest}>
      {children}
    </div>
  )
}

export type ControlModuleProps = RootProps<
  'button',
  {
    title: string
    /** Opens it out. */
    onClick: (event: MouseEvent<HTMLButtonElement>) => void
    /** A word beside the title: 7 accounts. */
    aside?: ReactNode
    /** Where it sits in the grid. Without it, across every column. */
    place?: ControlPlace
    /** What it says at a glance, spread down its height: a ControlAgents, a ControlMarks and a ControlLine. Nothing in it is pressable; the module is. */
    children?: ReactNode
  }
>

/**
 * One module: a glance at where something stands, which opens out when
 * pressed. Narrow, as a tall module in a column of its own, its title wraps
 * and its chevron gives way.
 */
export function ControlModule({
  title,
  aside,
  place,
  onClick,
  children,
  className,
  style,
  type = 'button',
  ref,
  ...rest
}: ControlModuleProps) {
  const [attach, mark] = useRemembered<HTMLButtonElement>(title, ref)
  return (
    <button
      type={type}
      ref={attach}
      className={cx(s.module, s.opens, className)}
      style={placed(place, style)}
      onClick={(event) => {
        mark()
        onClick(event)
      }}
      {...rest}
    >
      <span className={s.head}>
        <span className={s.title}>{title}</span>
        {aside !== undefined && <span className={s.aside}>{aside}</span>}
        <Icon name="chevron" size={11} className={s.chevron} />
      </span>
      {children}
    </button>
  )
}

export interface ControlToggleProps {
  title: string
  /** Where it stands, under the title: While work runs. */
  line?: ReactNode
  on: boolean
  onChange: (on: boolean) => void
  /** What the round switch shows. */
  glyph: ReactNode
  /** Opens it out, for the rest of its settings. Without it, the name is only text. */
  onOpen?: () => void
  /** Where it sits in the grid. Without it, across two columns. */
  place?: ControlPlace
  className?: string
}

/** A module with a round switch: the circle turns it on or off; the name opens it out. */
export function ControlToggle({ title, line, on, onChange, glyph, onOpen, place, className }: ControlToggleProps) {
  // Back from its detail: focus returns to its words, as to a module.
  const [attach, mark] = useRemembered<HTMLButtonElement>(title)
  const words = (
    <>
      <span className={s.toggleTitle}>{title}</span>
      {line !== undefined && <span className={s.toggleLine}>{line}</span>}
    </>
  )
  return (
    <div className={cx(s.module, s.half, s.toggle, className)} style={placed(place)}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        className={cx(s.circle, on && s.circleOn)}
        onClick={() => onChange(!on)}
      >
        {glyph}
      </button>
      {onOpen ? (
        <button
          type="button"
          ref={attach}
          className={s.toggleWords}
          onClick={() => {
            mark()
            onOpen()
          }}
        >
          {words}
        </button>
      ) : (
        <span className={s.toggleWords}>{words}</span>
      )}
    </div>
  )
}

/* ---- what a module shows at a glance ----------------------------------------------- */

export interface ControlLineText {
  yours: string
}

export const controlLineText: ControlLineText = { yours: 'needs you' }

export interface ControlLineProps {
  /** quiet: it can't run for now, and comes back by itself. yours: only the person can fix it, in violet with a dot. */
  tone?: 'quiet' | 'yours' | undefined
  children: ReactNode
  text?: Partial<ControlLineText>
}

/** Where something stands, in a word under its name: quiet, or violet with a dot where only the person can put it right. */
export function ControlLine({ tone, children, text }: ControlLineProps) {
  const t = { ...controlLineText, ...text }
  return (
    <span className={cx(s.line, tone === 'yours' && s.yoursLine)}>
      {tone === 'yours' && <span className={s.dot} aria-hidden="true" />}
      {children}
      {tone === 'yours' && <VisuallyHidden>, {t.yours}</VisuallyHidden>}
    </span>
  )
}

export interface AgentGlance {
  id: string
  name: string
  brand?: Brand
  /** One line: how many accounts while all is well, or what is off. */
  line: string
  /** quiet: it can't run for now, and comes back by itself. yours: only the person can fix it. */
  tone?: 'quiet' | 'yours'
}

/** The agents, one under another, each with a word on where it stands: inside the Agents module, spread down its height. */
export function ControlAgents({ agents, text }: { agents: readonly AgentGlance[]; text?: Partial<ControlLineText> }) {
  return (
    <span className={s.agents}>
      {agents.map((agent) => (
        <span key={agent.id} className={s.agent}>
          <BrandChip brand={agent.brand} size={30} className={s.flatChip} />
          <span className={s.agentWords}>
            <span className={s.agentName}>{agent.name}</span>
            <ControlLine tone={agent.tone} {...(text === undefined ? {} : { text })}>
              {agent.line}
            </ControlLine>
          </span>
        </span>
      ))}
    </span>
  )
}

export interface MarkGlance {
  id: string
  name: string
  brand?: Brand
  /** Not connected: drawn faint. */
  faint?: boolean
  /** It needs the person: a violet dot on it. */
  yours?: boolean
}

/** Marks, small, as many to a row as there is room for, faint for what isn't set up, a dot on what needs you: inside the code hosts module. */
export function ControlMarks({ marks, text }: { marks: readonly MarkGlance[]; text?: Partial<ControlLineText> }) {
  const t = { ...controlLineText, ...text }
  return (
    <span className={s.marks}>
      {marks.map((mark) => (
        <span key={mark.id} className={cx(s.mark, mark.faint && s.faint)}>
          <BrandChip brand={mark.brand} size={24} className={s.flatChip} />
          <VisuallyHidden>
            {mark.name}
            {mark.yours && `, ${t.yours}`}
          </VisuallyHidden>
          {mark.yours && <span className={s.markDot} aria-hidden="true" />}
        </span>
      ))}
    </span>
  )
}

export interface ControlWordsProps {
  /** Where it stands, in a few words: Connected as balazs. */
  title: ReactNode
  /** A quieter line under it, which wraps: what always asks you. */
  line?: ReactNode
  /** The mark of the product it is about, before the words. */
  brand?: Brand
  /** Any other picture before the words, 30px square: a project's mark. */
  mark?: ReactNode
}

/** Where something stands in words, with a quieter line under them: inside a module with nothing to count. */
export function ControlWords({ title, line, brand, mark }: ControlWordsProps) {
  return (
    <span className={s.words}>
      {brand !== undefined && <BrandChip brand={brand} size={30} className={s.flatChip} />}
      {mark}
      <span className={s.agentWords}>
        <span className={s.wordsTitle}>{title}</span>
        {line !== undefined && <span className={s.wordsLine}>{line}</span>}
      </span>
    </span>
  )
}

export type ControlPictureProps = RootProps<
  'button',
  {
    title: string
    /** What the picture shows, under the title: Cobalt, Round the notch. It changes when the picture does. */
    name: string
    /** The picture, small, at its own size and no taller than 36px: the app's icon, the edge of the screen. */
    picture: ReactNode
    /** Opens it out. */
    onClick: (event: MouseEvent<HTMLButtonElement>) => void
    /** Where it sits in the grid. Without it, across two columns. */
    place?: ControlPlace
  }
>

/** A module that is a picture, small, over its title and what it shows, with a small pop when that changes. Opens out when pressed. */
export function ControlPicture({
  title,
  name,
  picture,
  onClick,
  place,
  className,
  style,
  type = 'button',
  ref,
  ...rest
}: ControlPictureProps) {
  // Back from what it opened, focus comes back to it, as to a module.
  const [attach, mark] = useRemembered<HTMLButtonElement>(title, ref)
  return (
    <button
      ref={attach}
      type={type}
      className={cx(s.module, s.half, s.picture, className)}
      style={placed(place, style)}
      onClick={(event) => {
        mark()
        onClick(event)
      }}
      {...rest}
    >
      <span key={name} className={s.pictureImage} aria-hidden="true">
        {picture}
      </span>
      <span className={s.pictureTitle}>{title}</span>
      <span className={s.pictureName}>{name}</span>
    </button>
  )
}

export interface DockPreviewProps {
  /** What is in the Dock: its name, which bounces it when it changes. */
  name: string
  /** The picture, as the Dock shows it. */
  picture: ReactNode
  /** How large each app in it is, in px. */
  size?: number
  className?: string
}

/** The app's icon in a Dock among others drawn plain, on a desk: where it will be seen. It bounces when it changes. Only a picture. */
export function DockPreview({ name, picture, size = 52, className }: DockPreviewProps) {
  // Bounces on a change, not on first showing.
  const [shown, setShown] = useState(name)
  const [bounces, setBounces] = useState(0)
  if (name !== shown) {
    setShown(name)
    setBounces((n) => n + 1)
  }
  const app = { width: size, height: size }
  return (
    <div className={cx(s.desk, className)} aria-hidden="true">
      <div className={s.dock}>
        <span className={cx(s.dockApp, s.ghost)} style={app} />
        <span className={cx(s.dockApp, s.ghost)} style={app} />
        <span className={s.dockApp} style={app}>
          <span key={bounces} className={cx(s.dockIcon, bounces > 0 && s.bounce)}>
            {picture}
          </span>
          <i className={s.dockDot} />
        </span>
        <span className={cx(s.dockApp, s.ghost)} style={app} />
        <span className={s.dockRule} />
        <span className={cx(s.dockApp, s.ghost, s.bin)} style={app} />
      </div>
    </div>
  )
}

/* ---- a module, opened out -------------------------------------------------------- */

export interface ControlDetailText {
  back: string
}

export const controlDetailText: ControlDetailText = { back: 'Back to all settings' }

export interface ControlDetailProps {
  title: string
  /** A word at the head's end: 3 agents · 6 accounts. Or a switch for the whole of it. */
  aside?: ReactNode
  /** Beside the title, in the head: tabs for what it holds, one at a time. */
  beside?: ReactNode
  onBack: () => void
  headingLevel?: HeadingLevel
  /** What it holds: ControlSheets, or a part that brings its own. */
  children: ReactNode
  className?: string
  text?: Partial<ControlDetailText>
}

/** A module opened out in the panel, with a way back to all of them. */
export function ControlDetail({ title, aside, beside, onBack, headingLevel = 2, children, className, text }: ControlDetailProps) {
  const t = { ...controlDetailText, ...text }
  const heading = useRef<HTMLHeadingElement>(null)
  // Opened out from a module, which went with the focus: it lands on the title, so a screen reader says where it is.
  useEffect(() => {
    if (focusLost()) heading.current?.focus()
  }, [])
  return (
    <div className={cx(s.detail, className)}>
      <header className={s.detailHead}>
        <IconButton icon="chevron" label={t.back} size="small" className={s.back} onClick={onBack} />
        <Heading ref={heading} level={headingLevel} tabIndex={-1} className={s.detailTitle}>
          {title}
        </Heading>
        {beside !== undefined && <span className={s.beside}>{beside}</span>}
        {aside !== undefined && <span className={s.detailAside}>{aside}</span>}
      </header>
      {children}
    </div>
  )
}

export type ControlSheetProps = RootProps<'div', { children: ReactNode }>

/** A lighter sheet in the panel, for what an opened module holds. */
export function ControlSheet({ children, className, ...rest }: ControlSheetProps) {
  return (
    <div className={cx(s.sheet, className)} {...rest}>
      {children}
    </div>
  )
}

/** The panel's foot: the version and quiet links beside it, and a setting that matters least as a quiet link at its end. A long foot wraps. */
export function ControlFoot({ children, className, ...rest }: RootProps<'div', { children: ReactNode }>) {
  return (
    <div className={cx(s.foot, className)} {...rest}>
      {children}
    </div>
  )
}

/** The foot's start: what it says of this Althar, one line under another, so the foot's one button stays beside it on the same row. */
export function ControlFootStart({ children, className, ...rest }: RootProps<'div', { children: ReactNode }>) {
  return (
    <div className={cx(s.footStart, className)} {...rest}>
      {children}
    </div>
  )
}

export interface ControlLinkText {
  off: string
}

export const controlLinkText: ControlLinkText = { off: 'Off' }

export type ControlLinkProps = RootProps<
  'button',
  {
    title: string
    /** A tiny picture before the name, 16px: whose face it puts on things. */
    picture: ReactNode
    /** Off: the picture fades and Off follows the name. */
    off?: boolean
    /** Opens it out. */
    onClick: (event: MouseEvent<HTMLButtonElement>) => void
    text?: Partial<ControlLinkText>
  }
>

/** A setting at its smallest, in the panel's foot: its picture, tiny, and its name, which opens it out. */
export function ControlLink({ title, picture, off = false, onClick, className, type = 'button', ref, text, ...rest }: ControlLinkProps) {
  const t = { ...controlLinkText, ...text }
  // Back from what it opened, focus comes back to it, as to a module.
  const [attach, mark] = useRemembered<HTMLButtonElement>(title, ref)
  return (
    <button
      ref={attach}
      type={type}
      className={cx(s.link, className)}
      onClick={(event) => {
        mark()
        onClick(event)
      }}
      {...rest}
    >
      <span className={cx(s.linkPicture, off && s.faded)} aria-hidden="true">
        {picture}
      </span>
      <span>
        {title}
        {off && (
          <>
            {' '}
            <span className={s.linkOff}>{t.off}</span>
          </>
        )}
      </span>
      <Icon name="chevron" size={10} className={s.linkChevron} />
    </button>
  )
}
