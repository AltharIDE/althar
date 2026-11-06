// Scrappy: the browser's own bar, in Althar's chrome: back, forward, reload, the address with its session, then what the direction adds,
// Comment and Open in your browser. Under it, one line where something was refused, asked for or sent.
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Icon } from '../../../src/foundations/Icon/Icon'
import { keys } from '../../../src/foundations/keys'
import { cx } from '../../../src/lib/cx'
import { ChromeButton } from '../../../src/chrome/ChromeButton/ChromeButton'
import { IconButton } from '../../../src/primitives/IconButton/IconButton'
import { LinkButton } from '../../../src/primitives/LinkButton/LinkButton'
import { Popover } from '../../../src/primitives/Popover/Popover'
import { shown } from '../addresses'
import { addressOf, type Page, pageOf, proto, useProto } from '../state'
import s from './Bar.module.css'
import { glyph } from './icons'

/** ⇧⌘C, as a browser's inspector has it: point at something. */
export const COMMENT_KBD = `${keys.shift}${keys.mod}C`

export interface BarProps {
  scope: string
  page: Page
  /** The run's host, fixed: only its path is typed (B). */
  host?: string
  /** What the direction adds before Comment: a width, a way to compare. */
  extra?: ReactNode
  /** What the session is: a page's own, or a task's. */
  session: 'page' | 'task'
  /** Pointing is offered: not on a page that isn't one. */
  pointable?: boolean
  /** What the person's browser opens: the address now, unless the direction says otherwise. */
  outside?: string
  /** After Open in your browser: the ways out of where it is (E). */
  after?: ReactNode
  className?: string
}

export function Bar({ scope, page, host, extra, session, pointable = true, outside, after, className }: BarProps) {
  const p = useProto()
  const address = addressOf(page)
  const path = (() => {
    try {
      const url = new URL(address)
      return `${url.pathname}${url.search}${url.hash}`
    } catch {
      return '/'
    }
  })()
  const rest = host === undefined ? (address === '' ? '' : shown(address)) : path
  const [typed, setTyped] = useState(rest)
  const [editing, setEditing] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!editing) setTyped(rest)
  }, [rest, editing])
  // A new, empty tab is ready for an address.
  useEffect(() => {
    if (address === '' && host === undefined) field.current?.focus()
  }, [address, host])
  const pointing = p.pointing === scope
  return (
    <div className={cx(s.bar, className)}>
      <div className={s.moves}>
        <IconButton icon="chevronL" label="Back" size="small" disabled={page.at === 0} onClick={() => proto.back(scope)} />
        <IconButton
          icon="chevron"
          label="Forward"
          size="small"
          disabled={page.at >= page.history.length - 1}
          onClick={() => proto.forward(scope)}
        />
        <IconButton icon={glyph('reload')} label="Reload" size="small" onClick={() => proto.reload(scope)} />
      </div>
      <form
        className={cx(s.address, editing && s.editing)}
        onSubmit={(event) => {
          event.preventDefault()
          proto.navigate(scope, host === undefined ? typed : `http://${host}${typed.startsWith('/') ? typed : `/${typed}`}`)
          setEditing(false)
          field.current?.blur()
        }}
      >
        <Session scope={scope} session={session} address={address} />
        {host !== undefined && <span className={s.host}>{host}</span>}
        <input
          ref={field}
          className={s.field}
          value={editing ? typed : rest}
          spellCheck={false}
          aria-label={host === undefined ? 'Address' : 'Path'}
          placeholder={host === undefined ? 'Address' : '/'}
          onFocus={(event) => {
            setEditing(true)
            setTyped(host === undefined ? address : path)
            const input = event.currentTarget
            window.requestAnimationFrame(() => input.select())
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            // The address's own: it doesn't also close the panel it is in.
            event.preventDefault()
            setTyped(rest)
            setEditing(false)
            event.currentTarget.blur()
          }}
          onChange={(event) => setTyped(event.target.value)}
        />
      </form>
      <div className={s.ends}>
        {extra}
        {pointable && (
          <ChromeButton
            icon={glyph('comment')}
            label="Comment"
            kbd={COMMENT_KBD}
            expanded={pointing}
            aria-pressed={pointing}
            onClick={() => proto.point(pointing ? null : scope)}
          />
        )}
        <IconButton
          icon="external"
          label="Open in your browser"
          size="small"
          tooltipAlign="end"
          disabled={address === ''}
          onClick={() => proto.outside(outside ?? address)}
        />
        {after}
      </div>
    </div>
  )
}

/** The page's own session, on request: what it is kept apart from, and what it never gets. */
function Session({ scope, session, address }: { scope: string; session: 'page' | 'task'; address: string }) {
  const p = useProto()
  const asked = p.lines[scope]?.kind === 'permission'
  return (
    <Popover
      label="Its own session"
      width={300}
      placement="below"
      align="start"
      trigger={
        <button type="button" className={cx(s.session, asked && s.asked)} aria-label="Its own session">
          <Icon name={glyph('session')} size={13} />
        </button>
      }
    >
      <div className={s.facts}>
        <strong>{session === 'task' ? 'This task’s own session' : 'Its own session'}</strong>
        <ul>
          <li>
            {session === 'task'
              ? 'Cookies and storage of its own, apart from Althar, your browser and other tasks.'
              : 'Cookies and storage of its own, apart from Althar and your browser.'}
          </li>
          <li>Never the camera, microphone, location or notifications.</li>
          <li>Sign-ins open in your browser.</li>
        </ul>
        <div className={s.factsActions}>
          <LinkButton onClick={() => proto.reload(scope)}>Clear its cookies and storage</LinkButton>
          {address !== '' && <LinkButton onClick={() => proto.outside(address)}>Open in your browser</LinkButton>}
        </div>
      </div>
    </Popover>
  )
}

/** The one line under the bar: a scheme refused, a file kept out, a permission refused, comments sent. */
export function Line({ scope }: { scope: string }) {
  const p = useProto()
  const line = p.lines[scope]
  if (line === undefined || line.kind === 'sent') return null
  const dismiss = <IconButton icon="close" label="Dismiss" size="small" onClick={() => proto.line(scope, undefined)} />
  switch (line.kind) {
    case 'scheme':
      return (
        <div className={s.line} role="status">
          <Icon name="stop" size={13} />
          <span>Only web pages open here.</span>
          <span className={s.grow} />
          {dismiss}
        </div>
      )
    case 'file':
      return (
        <div className={s.line} role="status">
          <Icon name="file" size={13} />
          <span>Files don’t open here.</span>
          <code className={s.path}>{line.path.replace('/Users/balazs', '~')}</code>
          <LinkButton onClick={() => proto.line(scope, undefined)}>Show in folder</LinkButton>
          <span className={s.grow} />
          {dismiss}
        </div>
      )
    case 'permission':
      return (
        <div className={s.line} role="status">
          <Icon name={glyph('session')} size={13} />
          <span>
            {line.host} asked for the {line.what}. Pages here never get it.
          </span>
          <LinkButton onClick={() => proto.outside(addressOf(pageOf(scope) ?? proto.get().preview))}>Open in your browser</LinkButton>
          <span className={s.grow} />
          {dismiss}
        </div>
      )
  }
}
