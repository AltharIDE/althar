import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { safeHref } from '../../lib/safeHref'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { Field, FieldError } from '../../primitives/Field/Field'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './Connections.module.css'

/*
 * The code hosts and trackers Althar reaches for you: each service, who
 * you are signed in as there, or the one thing that would connect it.
 * Signing in is the service's own: a code you type on its page, or a page
 * you approve in your browser. Where Althar has neither for a service,
 * you paste a token, which is kept encrypted for Althar alone and never
 * shown again. A company's own server is connected by its address.
 */

export interface ServiceOption {
  /** The product: github, linear. */
  id: string
  name: string
  brand?: Brand
  /** What Althar does with it, in a few words: Pull requests and issues. */
  what?: string
  /** The hosted service's address; null for a service only on a company's own server. */
  hostedUrl: string | null
  /** A company's own server can be connected, by its address. */
  selfHosted: boolean
  /** Its own sign-in, in the browser, is set up here. */
  browserSignIn: boolean
  /** What a pasted token goes with: the account's email, or the API key it was made for. */
  tokenNeeds?: 'email' | 'key'
  /** Where a token is made, on the hosted service. */
  tokenHelp: string
  /** Where a token is made for the API key typed, with `{key}` where it goes: offered once the key looks right. */
  tokenHelpForKey?: string
  /** What a typed API key is checked against before it is sent: the first pattern it matches says what is wrong with it. */
  keyChecks?: readonly { pattern: string; says: string }[]
  /** An example of its address, for a service connected by one: https://your-site.atlassian.net. */
  instanceExample?: string
}

export interface ServiceConnection {
  id: string
  /** Which service, by its id. */
  service: string
  /** Who it signs in as: a login, or a name. */
  account: string
  /** Its server, when it isn't the hosted service. */
  instance?: string
  /** Its token stopped working: it needs signing in again. */
  needsSignIn?: boolean
}

/** A sign-in under way: a code to type on the service's page, a page to approve, or how it ended. */
export type ServiceSignIn =
  | { service: string; kind: 'device'; code: string; url: string }
  | { service: string; kind: 'browser'; url: string }
  | { service: string; kind: 'ended'; message: string }

export interface ServiceToken {
  /** The server's address, for a company's own; absent for the hosted service. */
  instance?: string
  /** The account's email, where the service wants it with the token. */
  user?: string
  /** The API key the token was made for, where the service wants it. */
  key?: string
  token: string
}

export interface ConnectionsText {
  notConnected: string
  signedInAs: (account: string) => string
  needsSignIn: string
  signIn: string
  signInAgain: string
  useToken: string
  addToken: string
  addServer: string
  disconnect: string
  typeCode: (service: string) => string
  openPage: (host: string) => string
  waiting: string
  approve: (service: string) => string
  openAgain: string
  tryAgain: string
  cancel: string
  save: string
  instance: string
  instancePlaceholder: string
  user: string
  key: string
  token: (service: string) => string
  makeToken: (service: string) => string
  makeTokenForKey: string
  tokenNote: string
  emptyToken: string
  emptyUser: string
  emptyKey: string
  emptyInstance: string
}

export const connectionsText: ConnectionsText = {
  notConnected: 'Not connected',
  signedInAs: (account) => `Signed in as ${account}`,
  needsSignIn: 'Its sign-in stopped working',
  signIn: 'Sign in',
  signInAgain: 'Sign in again',
  useToken: 'Use a token',
  addToken: 'Add a token',
  addServer: 'Add a server',
  disconnect: 'Disconnect',
  typeCode: (service) => `Type this code on ${service}`,
  openPage: (host) => `Open ${host}`,
  waiting: 'Waiting for you',
  approve: (service) => `Approve Althar on ${service}, in your browser.`,
  openAgain: 'Open it again',
  tryAgain: 'Try again',
  cancel: 'Cancel',
  save: 'Save',
  instance: 'Server address',
  instancePlaceholder: 'https://git.example.com',
  user: 'Email',
  key: 'API key',
  token: (service) => `${service} token`,
  makeToken: (service) => `Make one on ${service}`,
  makeTokenForKey: 'Make a token for this key',
  tokenNote: 'Kept encrypted on this Mac, for Althar alone. It’s never shown again.',
  emptyToken: 'Paste the token first',
  emptyUser: 'Type the email the token belongs to',
  emptyKey: 'Paste the API key the token was made for',
  emptyInstance: 'Type the server’s address',
}

export interface ConnectionsProps {
  /** What the list is, for a screen reader: Code hosts and trackers. */
  label: string
  services: readonly ServiceOption[]
  connections: readonly ServiceConnection[]
  /** A sign-in under way, or how one ended. */
  signingIn?: ServiceSignIn | null
  /** Starts a service's own sign-in, on its hosted service or a server by its address. */
  onSignIn: (service: string, instance?: string) => void
  onCancelSignIn: () => void
  /** Connects with a pasted token. */
  onToken: (service: string, token: ServiceToken) => void
  /** The service whose token is being checked. While it is, its form stays open; when it clears without an error, the form closes. */
  saving?: string | null
  /** Why a token was not taken, for that service. */
  tokenError?: { service: string; message: ReactNode } | null
  onDisconnect: (connectionId: string) => void
  className?: string
  text?: Partial<ConnectionsText>
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The services Althar can reach for you, each with who you are there, or how to connect it. */
export function Connections({
  label,
  services,
  connections,
  signingIn,
  onSignIn,
  onCancelSignIn,
  onToken,
  saving,
  tokenError,
  onDisconnect,
  className,
  text,
}: ConnectionsProps) {
  const t = { ...connectionsText, ...text }
  /* the service whose token form is open, and whether it asks for a server's address */
  const [tokenFor, setTokenFor] = useState<{ service: string; server: boolean } | null>(null)
  /* a token the consumer checks: the form waits for it, and closes if nothing went wrong */
  const checking = useRef(saving ?? null)
  useEffect(() => {
    const was = checking.current
    checking.current = saving ?? null
    if (was !== null && was === tokenFor?.service && saving !== was && tokenError?.service !== was) setTokenFor(null)
  }, [saving, tokenError, tokenFor])

  return (
    <ul aria-label={label} className={cx(s.list, className)}>
      {services.map((service) => {
        const mine = connections.filter((connection) => connection.service === service.id)
        const signing = signingIn?.service === service.id ? signingIn : null
        const signIn = () => {
          setTokenFor(null)
          onSignIn(service.id)
        }
        const token = (server: boolean) => () => setTokenFor({ service: service.id, server })
        const open = tokenFor?.service === service.id
        return (
          <li key={service.id} className={s.service}>
            <div className={cx(s.row, s.head)}>
              <span className={s.mark}>
                {service.brand ? <BrandMark brand={service.brand} size={18} /> : <Icon name="plug" size={16} />}
              </span>
              <span className={s.name}>{service.name}</span>
              {mine.length === 0 && (
                <span className={cx(s.line, s.status)}>{service.what ? `${t.notConnected} · ${service.what}` : t.notConnected}</span>
              )}
              {mine.length === 0 && signing === null && !open && (
                <span className={s.actions}>
                  {service.browserSignIn ? (
                    <>
                      <ActionButton onClick={token(false)}>{t.useToken}</ActionButton>
                      <Button onClick={signIn}>{t.signIn}</Button>
                    </>
                  ) : (
                    <Button onClick={token(service.hostedUrl === null)}>{t.addToken}</Button>
                  )}
                </span>
              )}
              {mine.length > 0 && service.selfHosted && signing === null && !open && (
                <span className={s.actions}>
                  <ActionButton icon="plus" onClick={token(true)}>
                    {t.addServer}
                  </ActionButton>
                </span>
              )}
            </div>
            {mine.map((connection) => (
              <div key={connection.id} className={cx(s.row, s.account)}>
                <span />
                <span className={s.body}>
                  <span className={cx(s.line, connection.needsSignIn && s.calls)}>
                    {connection.needsSignIn ? t.needsSignIn : t.signedInAs(connection.account)}
                    {connection.instance && <span className={s.instance}> · {hostOf(connection.instance)}</span>}
                  </span>
                </span>
                <span className={s.actions}>
                  <ActionButton onClick={() => onDisconnect(connection.id)}>{t.disconnect}</ActionButton>
                  {connection.needsSignIn && signing === null && (
                    <Button
                      variant="signal"
                      onClick={
                        service.browserSignIn && connection.instance === undefined ? signIn : token(connection.instance !== undefined)
                      }
                    >
                      {t.signInAgain}
                    </Button>
                  )}
                </span>
              </div>
            ))}
            {signing !== null && <SigningIn signing={signing} service={service} t={t} onCancel={onCancelSignIn} onRetry={signIn} />}
            {open && (
              <TokenForm
                service={service}
                server={tokenFor.server}
                t={t}
                saving={saving === service.id}
                error={tokenError?.service === service.id ? tokenError.message : undefined}
                onSave={(given) => {
                  onToken(service.id, given)
                  if (saving === undefined) setTokenFor(null)
                }}
                onCancel={() => setTokenFor(null)}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function SigningIn({
  signing,
  service,
  t,
  onCancel,
  onRetry,
}: {
  signing: ServiceSignIn
  service: ServiceOption
  t: ConnectionsText
  onCancel: () => void
  onRetry: () => void
}) {
  switch (signing.kind) {
    case 'device':
      return (
        <div className={s.panel}>
          <p className={s.prompt}>{t.typeCode(service.name)}</p>
          <div className={s.code}>
            <span className={s.codeText}>{signing.code}</span>
            <CopyButton value={signing.code} />
          </div>
          <div className={s.foot}>
            <a className={s.link} href={safeHref(signing.url)} target="_blank" rel="noreferrer">
              {t.openPage(hostOf(signing.url))}
              <Icon name="external" size={12} />
            </a>
            <span className={s.waiting}>
              <Spinner size="small" />
              {t.waiting}
            </span>
            <Button variant="quiet" onClick={onCancel}>
              {t.cancel}
            </Button>
          </div>
        </div>
      )
    case 'browser':
      return (
        <div className={s.panel}>
          <p className={s.prompt}>{t.approve(service.name)}</p>
          <div className={s.foot}>
            <a className={s.link} href={safeHref(signing.url)} target="_blank" rel="noreferrer">
              {t.openAgain}
              <Icon name="external" size={12} />
            </a>
            <span className={s.waiting}>
              <Spinner size="small" />
              {t.waiting}
            </span>
            <Button variant="quiet" onClick={onCancel}>
              {t.cancel}
            </Button>
          </div>
        </div>
      )
    case 'ended':
      return (
        <div className={s.panel} role="alert">
          <p className={s.prompt}>{signing.message}</p>
          <div className={s.foot}>
            <Button variant="quiet" onClick={onCancel}>
              {t.cancel}
            </Button>
            <Button onClick={onRetry}>{t.tryAgain}</Button>
          </div>
        </div>
      )
  }
}

/*
 * The fields a token needs: the server's address for a company's own, what
 * the service wants with the token (the account's email, or the API key it
 * was made for), and the token.
 */
function TokenForm({
  service,
  server,
  t,
  saving,
  error,
  onSave,
  onCancel,
}: {
  service: ServiceOption
  server: boolean
  t: ConnectionsText
  saving: boolean
  error?: ReactNode
  onSave: (token: ServiceToken) => void
  onCancel: () => void
}) {
  const [instance, setInstance] = useState('')
  /* the account's email, or the API key, as the service wants */
  const [paired, setPaired] = useState('')
  const [token, setToken] = useState('')
  const needs = service.tokenNeeds
  const emptyPaired = needs === 'email' ? t.emptyUser : t.emptyKey
  const typedKey = needs === 'key' ? paired.trim() : ''
  /* what is wrong with the key typed, as the service checks it */
  const keyWrong = typedKey === '' ? undefined : service.keyChecks?.find((check) => new RegExp(check.pattern).test(typedKey))?.says
  /* where a token is made for the key typed, once it looks right */
  const forKey =
    typedKey === '' || keyWrong !== undefined || service.tokenHelpForKey === undefined
      ? undefined
      : service.tokenHelpForKey.replace('{key}', encodeURIComponent(typedKey))
  const [missing, setMissing] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const errorId = useId()
  useEffect(() => first.current?.focus(), [])
  const save = () => {
    if (saving) return
    const empty =
      server && !instance.trim()
        ? t.emptyInstance
        : needs !== undefined && !paired.trim()
          ? emptyPaired
          : keyWrong !== undefined
            ? keyWrong
            : !token.trim()
              ? t.emptyToken
              : null
    if (empty !== null) return setMissing(empty)
    onSave({
      ...(server ? { instance: instance.trim() } : {}),
      ...(needs === 'email' ? { user: paired.trim() } : needs === 'key' ? { key: paired.trim() } : {}),
      token: token.trim(),
    })
  }
  const said = missing ?? error
  const pairedSaid = missing !== null && (missing === emptyPaired || missing === keyWrong)
  /* the token's own fault, or the service's word on it: not what is said of the address, email or key */
  const tokenSaid = Boolean(said) && !pairedSaid && missing !== t.emptyInstance
  const keys = {
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        save()
      }
      if (e.key === 'Escape') onCancel()
    },
  }
  return (
    <div className={s.panel} data-own-escape="">
      {server && (
        <label className={s.label}>
          {t.instance}
          <Field
            ref={first}
            type="url"
            spellCheck={false}
            placeholder={service.instanceExample ?? t.instancePlaceholder}
            value={instance}
            invalid={missing === t.emptyInstance}
            onChange={(e) => {
              setInstance(e.target.value)
              setMissing(null)
            }}
            {...keys}
          />
        </label>
      )}
      {needs !== undefined && (
        <label className={s.label}>
          {needs === 'email' ? t.user : t.key}
          <Field
            {...(server ? {} : { ref: first })}
            type={needs === 'email' ? 'email' : 'text'}
            autoComplete="off"
            spellCheck={false}
            {...(needs === 'key' ? { className: s.mono } : {})}
            value={paired}
            invalid={pairedSaid}
            aria-describedby={pairedSaid ? errorId : undefined}
            onChange={(e) => {
              setPaired(e.target.value)
              setMissing(null)
            }}
            {...keys}
          />
        </label>
      )}
      <label className={s.label}>
        {t.token(service.name)}
        <Field
          {...(server || needs !== undefined ? {} : { ref: first })}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className={s.mono}
          value={token}
          invalid={tokenSaid}
          aria-describedby={tokenSaid ? errorId : undefined}
          onChange={(e) => {
            setToken(e.target.value)
            setMissing(null)
          }}
          {...keys}
        />
      </label>
      {said ? <FieldError id={errorId}>{said}</FieldError> : <p className={s.note}>{t.tokenNote}</p>}
      <div className={s.foot}>
        {!server && (forKey !== undefined || service.tokenHelp) && (
          <a className={s.link} href={safeHref(forKey ?? service.tokenHelp)} target="_blank" rel="noreferrer">
            {forKey === undefined ? t.makeToken(service.name) : t.makeTokenForKey}
            <Icon name="external" size={12} />
          </a>
        )}
        <span className={s.spacer} />
        <Button variant="quiet" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button busy={saving} onClick={save}>
          {t.save}
        </Button>
      </div>
    </div>
  )
}
