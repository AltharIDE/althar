import { type ReactNode, type Ref, useState } from 'react'
import { flushSync } from 'react-dom'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import { Popover } from '../../primitives/Popover/Popover'
import { SidePanel } from '../../primitives/SidePanel/SidePanel'
import s from './PagePanel.module.css'

/*
 * A web page beside the conversation, on its workbench, or in a tab of its
 * own (ADR-100). Its head is the browser's bar: back, forward and reload,
 * the address in the page's own session, then the size the page is laid
 * out at, Comment, Open in your browser, Open as a tab (or back beside the
 * conversation), and Close. Under it, one quiet line where something was
 * refused, sent out or asked for, and the page itself, which the host draws
 * in its place (PageFrame). Escape closes it while focus is in it, never
 * while it is in the page.
 */

/** A size the page can be laid out at, as the Viewport menu offers it. */
export interface PageViewportOption<V extends string> {
  value: V
  label: string
  /** Its size, formatted: `390 × 844`. */
  hint?: string
}

export interface PagePanelText {
  /** The panel's name, for assistive technology. */
  label: string
  back: string
  forward: string
  reload: string
  stop: string
  address: string
  session: string
  viewport: string
  comment: string
  outside: string
  tab: string
  beside: string
  close: string
  /** The session's facts, in its popover. */
  sessionTitle: string
  sessionApart: string
  sessionKept: (keep: string) => string
  change: string
  sessionNever: string
  sessionSignIns: string
  clear: string
}

export const pagePanelText: PagePanelText = {
  label: 'Page',
  back: 'Back',
  forward: 'Forward',
  reload: 'Reload',
  stop: 'Stop loading',
  address: 'Address',
  session: 'Its own session',
  viewport: 'Viewport',
  comment: 'Comment',
  outside: 'Open in your browser',
  tab: 'Open as a tab',
  beside: 'Back beside the conversation',
  close: 'Close',
  sessionTitle: 'This task’s own session',
  sessionApart: 'Cookies and storage of its own, apart from Althar, your browser and other tasks.',
  sessionKept: (keep) => `Cookies kept ${keep}.`,
  change: 'Change',
  sessionNever: 'Never the camera, microphone, location or notifications.',
  sessionSignIns: 'Sign-ins open in your browser.',
  clear: 'Clear its cookies and storage',
}

export interface PagePanelProps<V extends string> {
  /** What the address field shows at rest: the address without what goes without saying. */
  address: string
  /** The address in full, as the field shows it to edit. */
  full: string
  loading?: boolean
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStop?: () => void
  /** An address the person typed and confirmed with Enter. */
  onNavigate: (typed: string) => void
  /** The address field, for the host to focus (⌘L in the page). */
  addressRef?: Ref<HTMLInputElement>
  /** How long the page's cookies are kept, in words that follow "Cookies kept": "until the task is done". */
  keep: string
  /** Changes how long: where the setting is. Without it, no Change. */
  onChangeKeep?: () => void
  onClear: () => void
  viewport: V
  viewports: readonly PageViewportOption<V>[]
  onViewport: (viewport: V) => void
  /** Points at the page to comment; without it, no Comment, as before anything has loaded. */
  onComment?: () => void
  pointing?: boolean
  /** Comment's key, shown in its tooltip; the host binds it. */
  commentKey?: string
  onOutside?: () => void
  /** Where it is: beside the conversation, or in a tab of its own; each offers the other. Without it, neither. */
  docked?: 'beside' | 'tab'
  onDock?: () => void
  onClose: () => void
  /** One quiet line under the bar: a PageLine. */
  line?: ReactNode
  /** The page, in its place: a PageFrame. */
  children: ReactNode
  className?: string
  text?: Partial<PagePanelText>
}

export function PagePanel<V extends string>({
  address,
  full,
  loading = false,
  canBack,
  canForward,
  onBack,
  onForward,
  onReload,
  onStop,
  onNavigate,
  addressRef,
  keep,
  onChangeKeep,
  onClear,
  viewport,
  viewports,
  onViewport,
  onComment,
  pointing = false,
  commentKey,
  onOutside,
  docked,
  onDock,
  onClose,
  line,
  children,
  className,
  text,
}: PagePanelProps<V>) {
  const t = { ...pagePanelText, ...text }
  const [editing, setEditing] = useState(false)
  /*
   * What the person typed and hasn't sent or put back, null where nothing
   * is. Focus going and coming back, as another window or a menu closing
   * takes it, keeps it; the page going elsewhere while the field is at rest
   * takes it. At rest the field shows the page's address.
   */
  const [typed, setTyped] = useState<string | null>(null)
  const [typedOn, setTypedOn] = useState(full)
  if (typedOn !== full) {
    setTypedOn(full)
    if (!editing) setTyped(null)
  }
  const chosen = viewports.find((one) => one.value === viewport)
  const fits = viewports[0]?.value === viewport
  const head = (
    <div className={s.bar}>
      <span className={s.moves}>
        <IconButton icon="chevronL" label={t.back} size="small" disabled={!canBack} onClick={onBack} />
        <IconButton icon="chevron" label={t.forward} size="small" disabled={!canForward} onClick={onForward} />
        {loading && onStop !== undefined ? (
          <IconButton icon="close" label={t.stop} size="small" onClick={onStop} />
        ) : (
          <IconButton icon="reload" label={t.reload} size="small" onClick={onReload} />
        )}
      </span>
      <form
        className={cx(s.address, editing && s.editing)}
        onSubmit={(event) => {
          event.preventDefault()
          const value = (typed ?? full).trim()
          if (value !== '') onNavigate(value)
          setTyped(null)
          setEditing(false)
          event.currentTarget.querySelector('input')?.blur()
        }}
      >
        <Popover
          label={t.session}
          width={300}
          placement="below"
          align="start"
          trigger={<IconButton icon="session" label={t.session} size="small" className={s.session} />}
        >
          <div className={s.facts}>
            <strong className={s.factsTitle}>{t.sessionTitle}</strong>
            <ul>
              <li>{t.sessionApart}</li>
              <li>
                {t.sessionKept(keep)} {onChangeKeep !== undefined && <LinkButton onClick={onChangeKeep}>{t.change}</LinkButton>}
              </li>
              <li>{t.sessionNever}</li>
              <li>{t.sessionSignIns}</li>
            </ul>
            <div className={s.factsActions}>
              <LinkButton onClick={onClear}>{t.clear}</LinkButton>
            </div>
          </div>
        </Popover>
        <input
          ref={addressRef}
          className={s.field}
          value={editing ? (typed ?? full) : address}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={t.address}
          placeholder={t.address}
          // Its own Escape: it puts the address back and leaves, without closing the panel.
          data-own-escape=""
          onFocus={(event) => {
            const input = event.currentTarget
            flushSync(() => setEditing(true))
            // What was typed before goes on from its end. Else the full address, selected before anything typed lands:
            // typed at once, it replaces the address rather than joining it.
            if (typed === null) input.select()
            else input.setSelectionRange(input.value.length, input.value.length)
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setTyped(null)
            setEditing(false)
            event.currentTarget.blur()
          }}
          onChange={(event) => setTyped(event.target.value)}
        />
      </form>
    </div>
  )
  const actions = (
    <>
      <Menu
        label={t.viewport}
        placement="below"
        align="end"
        trigger={
          fits ? (
            <IconButton icon="viewport" label={t.viewport} size="small" />
          ) : (
            <Button
              variant="quiet"
              size="small"
              icon="viewport"
              className={s.viewport}
              aria-label={`${t.viewport}: ${chosen?.label ?? ''}`}
            >
              {chosen?.hint ?? chosen?.label}
            </Button>
          )
        }
      >
        <MenuRadioGroup label={t.viewport} value={viewport} onChange={(value) => onViewport(value as V)}>
          {viewports.map((one) => (
            <MenuRadioItem key={one.value} value={one.value} {...(one.hint === undefined ? {} : { hint: one.hint })}>
              {one.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </Menu>
      {onComment !== undefined && (
        <Tooltip label={t.comment} kbd={commentKey} placement="above">
          <Button variant="quiet" size="small" icon="comment" aria-pressed={pointing} className={s.comment} onClick={onComment}>
            {t.comment}
          </Button>
        </Tooltip>
      )}
      {onOutside !== undefined && <IconButton icon="external" label={t.outside} size="small" tooltipAlign="end" onClick={onOutside} />}
      {docked !== undefined && onDock !== undefined && (
        <IconButton
          icon={docked === 'beside' ? 'tab' : 'beside'}
          label={docked === 'beside' ? t.tab : t.beside}
          size="small"
          tooltipAlign="end"
          onClick={onDock}
        />
      )}
    </>
  )
  return (
    <SidePanel
      label={t.label}
      head={head}
      actions={actions}
      onClose={onClose}
      className={cx(s.panel, className)}
      headClassName={s.head}
      text={{ close: t.close }}
    >
      {line}
      <div className={s.page}>{children}</div>
    </SidePanel>
  )
}

export interface PageLineProps {
  icon: IconName
  /** What happened, in a short sentence. */
  children: ReactNode
  /** What the person can do about it, as a link after the words. */
  action?: { label: string; onAction: () => void }
  /** Takes the line away. */
  onDismiss?: () => void
  text?: Partial<{ dismiss: string }>
}

/** The one quiet line under the bar: an address refused, a sign-in sent out, a permission refused, a download offered. */
export function PageLine({ icon, children, action, onDismiss, text }: PageLineProps) {
  const t = { dismiss: 'Dismiss', ...text }
  return (
    <output className={s.line}>
      <Icon name={icon} size={13} className={s.lineIcon} />
      <span className={s.lineWords}>{children}</span>
      {action !== undefined && <LinkButton onClick={action.onAction}>{action.label}</LinkButton>}
      {onDismiss !== undefined && <IconButton icon="close" label={t.dismiss} size="small" className={s.lineDismiss} onClick={onDismiss} />}
    </output>
  )
}
