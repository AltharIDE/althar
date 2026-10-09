import {
  createContext,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
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
 * say where each thing stands at a glance; what changes often is one press on
 * a round switch; any module opens out in place (ControlDetail) and steps
 * back. The panel grows to fit what is open in it, and opens out wide for a
 * part that needs the room. It is a Popover: Escape and a press outside close
 * it, unless it is `holding` something under way, like a sign-in the person
 * is finishing in their browser.
 *
 * Focus follows what is open: into an opened module's way back, and back to
 * the module it came from, so a keyboard carries on where it was.
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
  /** Opened out wide, for a part that needs the room. */
  wide?: boolean
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
  wide = false,
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
      padded={false}
      initialFocus="panel"
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      onEscapeKeyDown={onEscapeKeyDown}
      onInteractOutside={holding ? (e) => e.preventDefault() : undefined}
      className={cx(s.panel, wide && s.wide, className)}
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

export type ControlGridProps = RootProps<'div', { children: ReactNode }>

/** The modules, four columns across; a module spans two or all four. */
export function ControlGrid({ children, className, ...rest }: ControlGridProps) {
  return (
    <div className={cx(s.grid, className)} {...rest}>
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
    /** A word beside the title: 3 connected. */
    aside?: ReactNode
    /** How many of the grid's four columns it spans. */
    span?: 2 | 4
    /** What it says at a glance: a ControlAgents, a ControlMarks, a picture. Nothing in it is pressable; the module is. */
    children?: ReactNode
  }
>

/** One module: a glance at where something stands, which opens out when pressed. */
export function ControlModule({ title, aside, span = 4, onClick, children, className, type = 'button', ref, ...rest }: ControlModuleProps) {
  const opened = useContext(Opened)
  const self = useRef<HTMLButtonElement | null>(null)
  // Back from being opened out: focus returns here.
  useEffect(() => {
    if (opened?.take(title) && focusLost()) self.current?.focus()
  }, [opened, title])
  return (
    <button
      type={type}
      ref={(node) => {
        self.current = node
        if (typeof ref === 'function') return ref(node)
        if (ref) ref.current = node
      }}
      className={cx(s.module, span === 2 ? s.span2 : s.span4, className)}
      onClick={(event) => {
        opened?.mark(title)
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
  className?: string
}

/** A module with a round switch: the circle turns it on or off; the name opens it out. */
export function ControlToggle({ title, line, on, onChange, glyph, onOpen, className }: ControlToggleProps) {
  const words = (
    <>
      <span className={s.toggleTitle}>{title}</span>
      {line !== undefined && <span className={s.toggleLine}>{line}</span>}
    </>
  )
  return (
    <div className={cx(s.module, s.span2, s.toggle, className)}>
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
        <button type="button" className={s.toggleWords} onClick={onOpen}>
          {words}
        </button>
      ) : (
        <span className={s.toggleWords}>{words}</span>
      )}
    </div>
  )
}

/* ---- what a module shows at a glance ----------------------------------------------- */

export interface AgentGlance {
  id: string
  name: string
  brand?: Brand
  /** One line: its model while all is well, or what is off. */
  line: string
  /** quiet: it can't run for now, and comes back by itself. yours: only the person can fix it. */
  tone?: 'quiet' | 'yours'
}

export interface ControlAgentsText {
  yours: string
}

export const controlAgentsText: ControlAgentsText = { yours: 'needs you' }

/** The agents, each with a word on where it stands: inside the Agents module. */
export function ControlAgents({ agents, text }: { agents: readonly AgentGlance[]; text?: Partial<ControlAgentsText> }) {
  const t = { ...controlAgentsText, ...text }
  return (
    <span className={s.agents}>
      {agents.map((agent) => (
        <span key={agent.id} className={s.agent}>
          <BrandChip brand={agent.brand} size={30} className={s.flatChip} />
          <span className={s.agentWords}>
            <span className={s.agentName}>{agent.name}</span>
            <span className={cx(s.agentLine, agent.tone === 'yours' && s.yoursLine)}>
              {agent.tone === 'yours' && <span className={s.dot} aria-hidden="true" />}
              {agent.line}
              {agent.tone === 'yours' && <VisuallyHidden>, {t.yours}</VisuallyHidden>}
            </span>
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

/** Marks in a row, faint for what isn't set up, a dot on what needs you: inside the code hosts module. */
export function ControlMarks({ marks, text }: { marks: readonly MarkGlance[]; text?: Partial<ControlAgentsText> }) {
  const t = { ...controlAgentsText, ...text }
  return (
    <span className={s.marks}>
      {marks.map((mark) => (
        <span key={mark.id} className={cx(s.mark, mark.faint && s.faint)}>
          <BrandChip brand={mark.brand} size={30} className={s.flatChip} />
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

export type ControlPictureProps = RootProps<
  'button',
  {
    title: string
    /** What the picture is: Cobalt. It changes when the picture does. */
    name: string
    /** The picture, large: the app's icon. */
    picture: ReactNode
    /** Opens it out. */
    onClick: (event: MouseEvent<HTMLButtonElement>) => void
  }
>

/** A module that is a picture: large, with its name under it, and a small pop when it changes. Opens out when pressed. */
export function ControlPicture({ title, name, picture, onClick, className, type = 'button', ...rest }: ControlPictureProps) {
  const opened = useContext(Opened)
  const self = useRef<HTMLButtonElement>(null)
  // Back from what it opened, focus comes back to it, as to a module.
  useEffect(() => {
    if (opened?.take(title) && focusLost()) self.current?.focus()
  }, [opened, title])
  return (
    <button
      ref={self}
      type={type}
      className={cx(s.module, s.span2, s.picture, className)}
      onClick={(event) => {
        opened?.mark(title)
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
  /** A word at the head's end: 3 agents · 6 accounts. */
  aside?: ReactNode
  onBack: () => void
  headingLevel?: HeadingLevel
  /** What it holds: ControlSheets, or a part that brings its own. */
  children: ReactNode
  className?: string
  text?: Partial<ControlDetailText>
}

/** A module opened out in the panel, with a way back to all of them. */
export function ControlDetail({ title, aside, onBack, headingLevel = 2, children, className, text }: ControlDetailProps) {
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

/** The panel's foot: the version, a quiet link. */
export function ControlFoot({ children, className, ...rest }: RootProps<'div', { children: ReactNode }>) {
  return (
    <div className={cx(s.foot, className)} {...rest}>
      {children}
    </div>
  )
}
