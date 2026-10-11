import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ApiError,
  type ConnectGuide,
  type ConnectionCheck,
  type FoundServer,
  type Product,
  type ProductOption,
  type Service,
} from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { type StepKind, type Way, waysOf } from './ways'

/*
 * Connecting a service, a step at a time (docs/architecture/06, "Signing
 * in"): the view model behind the card, which any place can host. It reads
 * what connecting the service starts from, offers the ways that can work
 * here, and walks the one chosen: the service's own sign-in, opened in the
 * browser and waited on; gh's or glab's sign-in, copied; or a token made on
 * a page opened filled in, noticed on the clipboard as the window comes back
 * or pasted, with the server's address first for a company's own. Then it
 * asks the service what the connection can do. The clipboard is read only
 * while a step waits for a token, and only as the window comes back.
 */

/** How often a sign-in under way, and a GitHub App waiting to be let in, are asked how they stand. */
const POLL = 1_500
const INSTALL_POLL = 4_000
/** How long the address typed rests before the server is asked about it. */
const SETTLE = 600

export interface ConnectOptions {
  readonly service: Service
  /** A connection to sign in again: its address, and the email or key that went with its token, stay. */
  readonly again?: string | null
  /** Straight to a company's own server. */
  readonly server?: boolean
  /** It ended: connected, or stepped back from its start. */
  readonly onClose: () => void
}

/** Where the walk is connecting: the product, its address, and where a token is made there. */
export interface Instance {
  readonly product: Product
  readonly webUrl: string
  readonly tokenPage: string | null
}

/** A sign-in in the browser, under way: a code to type on a page, or a page to approve; or how it ended. */
export interface SignIn {
  readonly kind: 'device' | 'browser'
  readonly url: string
  readonly code: string | null
  readonly expiresAt: string | null
  readonly ended: string | null
}

export interface ConnectModel {
  readonly service: Service
  /** The connection being signed in again. */
  readonly again: { readonly id: string; readonly product: Product; readonly webUrl: string; readonly login: string } | null
  /** What the walk starts from; null while it is read, or where it couldn't be. */
  readonly guide: ConnectGuide | null
  /** The ways are still being found. */
  readonly reading: boolean
  readonly ways: ReadonlyArray<Way>
  /** A company's own server, offered under the ways. */
  readonly serverWay: Way | null
  /** The way chosen; null on the ways. */
  readonly way: Way | null
  readonly step: StepKind | null
  /** Where the step is in its way. */
  readonly at: number
  readonly instance: Instance | null
  /** The product being connected, as the runtime offers it: what its token goes with, what its tokens start with. */
  readonly option: ProductOption | null
  /** The server's address, as typed, and what answered there. */
  readonly address: { readonly typed: string; readonly found: FoundServer | null; readonly finding: boolean }
  readonly key: { readonly value: string; readonly error: string | null }
  readonly token: {
    readonly value: string
    readonly email: string
    readonly saving: boolean
    readonly error: string | null
    /** The email it goes with is missing. */
    readonly emailError: string | null
  }
  /** A token seen on the clipboard as the window came back. */
  readonly clip: string | null
  readonly signIn: SignIn | null
  readonly cli: { readonly busy: boolean; readonly error: string | null }
  /** The connection made, and who it signs in as. */
  readonly connection: { readonly id: string; readonly login: string } | null
  readonly check: ConnectionCheck | null
  readonly checking: boolean
  readonly checkError: string | null
  /** The service didn't take what was given, in its words. */
  readonly refused: string | null
  readonly choose: (way: string) => void
  readonly chooseServer: () => void
  /** Back to the ways. */
  readonly anotherWay: () => void
  /** A step back; false at the start, where the host goes back itself. */
  readonly back: () => boolean
  readonly setAddress: (typed: string) => void
  readonly confirmAddress: () => void
  readonly setKey: (key: string) => void
  readonly confirmKey: () => void
  readonly setToken: (token: string) => void
  readonly setEmail: (email: string) => void
  readonly submitToken: () => void
  readonly takeClip: () => void
  /** The step after a token is made: paste it, with the clipboard watched. */
  readonly pasteMyself: () => void
  /** Opens a page in the person's browser. */
  readonly open: (url: string) => void
  /** Opens a page that makes a token, and waits on the paste step for it. */
  readonly openAndPaste: (url: string) => void
  readonly takeCli: () => void
  readonly retrySignIn: () => void
  readonly checkAgain: () => void
  readonly done: () => void
}

const emptyAddress = { typed: null, found: null, finding: false } as const

export const useConnect = ({ service, again: againId = null, server = false, onClose }: ConnectOptions): ConnectModel => {
  const { client, cache, host } = useServices()
  const listRead = useQuery(reads(client).connections())
  const list = listRead.data ?? null
  const products = useMemo(() => list?.products ?? [], [list])
  const againSummary = againId === null ? undefined : list?.connections.find((connection) => connection.id === againId)
  const again = useMemo(
    () =>
      againSummary === undefined
        ? null
        : { id: againSummary.id, product: againSummary.product, webUrl: againSummary.webUrl, login: againSummary.account.login },
    [againSummary],
  )

  // What connecting starts from, read as the walk opens. Without it, the ways that need nothing found still work.
  const [guide, setGuide] = useState<ConnectGuide | null>(null)
  const [guideRead, setGuideRead] = useState(false)
  useEffect(() => {
    let live = true
    client.getConnectGuide(service).then(
      (read) => {
        if (!live) return
        setGuide(read)
        setGuideRead(true)
      },
      () => {
        if (live) setGuideRead(true)
      },
    )
    return () => {
      live = false
    }
  }, [client, service])

  const found = useMemo(() => waysOf(service, products, guide, againSummary ?? null), [service, products, guide, againSummary])
  const reading = !guideRead || list === null

  /* ---- where the walk is ---- */
  const [chosen, setChosen] = useState<string | null>(server ? 'server' : null)
  const [at, setAt] = useState(0)
  const way: Way | null =
    chosen === 'server'
      ? // Jira's own server is a site like any other.
        (found.server ?? found.ways.find((candidate) => candidate.kind === 'site') ?? null)
      : chosen !== null
        ? (found.ways.find((candidate) => candidate.id === chosen) ?? null)
        : !reading && found.ways.length === 1
          ? (found.ways[0] ?? null)
          : null
  const step = way?.steps[at] ?? null

  /* ---- what each step holds ---- */
  /* The address as typed; null until the person types, so a server a remote names fills it in. */
  const [address, setAddressState] = useState<{
    readonly typed: string | null
    readonly found: FoundServer | null
    readonly finding: boolean
  }>(emptyAddress)
  const [key, setKeyState] = useState<ConnectModel['key']>({ value: '', error: null })
  /* The token and what goes with it; its email null until the person types one, so the projects' own fills it in. */
  const [token, setTokenState] = useState<Omit<ConnectModel['token'], 'email'> & { readonly email: string | null }>({
    value: '',
    email: null,
    saving: false,
    error: null,
    emailError: null,
  })
  const [clip, setClip] = useState<string | null>(null)
  const [signIn, setSignIn] = useState<SignIn | null>(null)
  const [cli, setCli] = useState<ConnectModel['cli']>({ busy: false, error: null })
  const [connection, setConnection] = useState<ConnectModel['connection']>(null)
  const [check, setCheck] = useState<ConnectionCheck | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  /* A sign-in under way, by its flow; and the token last taken, so the clipboard doesn't offer it again. */
  const flow = useRef<string | null>(null)
  const taken = useRef<string | null>(null)
  /* Each start of a sign-in, counted: an answer to a start since stepped away from is cancelled, not shown. */
  const starts = useRef(0)
  const starting = useRef(false)

  // The email a token goes with: as typed, else the projects' git's, once it is known.
  const email = token.email ?? guide?.email?.address ?? ''

  const instance: Instance | null = useMemo(() => {
    if (way === null) return null
    if (way.kind === 'server' || way.kind === 'site') {
      const answered = address.found
      if (answered === null || answered.product === null) return null
      return { product: answered.product, webUrl: answered.webUrl, tokenPage: answered.tokenPage }
    }
    if (way.webUrl === null) return null
    const page = guide?.tokenPages.find((candidate) => candidate.product === way.product && candidate.webUrl === way.webUrl)
    return { product: way.product, webUrl: way.webUrl, tokenPage: page?.url ?? null }
  }, [way, address.found, guide])

  const cancelFlow = useCallback(() => {
    const current = flow.current
    flow.current = null
    if (current !== null) void client.cancelSignIn(current).catch(() => undefined)
  }, [client])

  /** Starts a way afresh: nothing of another way carries over. */
  const reset = useCallback(() => {
    starts.current += 1
    cancelFlow()
    setAt(0)
    setAddressState(emptyAddress)
    setKeyState({ value: '', error: null })
    setTokenState((was) => ({ value: '', email: was.email, saving: false, error: null, emailError: null }))
    setClip(null)
    setSignIn(null)
    setCli({ busy: false, error: null })
    setConnection(null)
    setCheck(null)
    setCheckError(null)
    setRefused(null)
  }, [cancelFlow])

  const goTo = useCallback(
    (kind: StepKind) => {
      if (way === null) return
      const index = way.steps.indexOf(kind)
      if (index >= 0) setAt(index)
    },
    [way],
  )

  const choose = useCallback(
    (id: string) => {
      reset()
      setChosen(id)
    },
    [reset],
  )
  const chooseServer = useCallback(() => {
    reset()
    setChosen('server')
  }, [reset])
  const anotherWay = useCallback(() => {
    reset()
    setChosen(null)
  }, [reset])

  // A server a remote names fills the address in, and is asked about as the step opens.
  const typed = address.typed ?? (way?.kind === 'server' ? (way.webUrl ?? '') : '')

  /* ---- a server's address ---- */
  const asked = useRef(0)
  const find = useCallback(
    (typed: string, then?: (answered: FoundServer) => void) => {
      const ask = (asked.current += 1)
      setAddressState((was) => ({ ...was, finding: true }))
      client.findServer(service, typed).then(
        (answered) => {
          if (ask !== asked.current) return
          setAddressState((was) => ({ ...was, found: answered, finding: false }))
          then?.(answered)
        },
        (failure: unknown) => {
          if (ask !== asked.current) return
          setAddressState((was) => ({
            ...was,
            finding: false,
            found: { product: null, webUrl: typed, reason: 'unreachable', tokenPage: null },
          }))
          setCheckError(messageOf(failure))
        },
      )
    },
    [client, service],
  )
  const addressStep = step === 'server' || step === 'site'
  useEffect(() => {
    if (!addressStep || typed.trim() === '') return
    const timer = setTimeout(() => find(typed), SETTLE)
    return () => clearTimeout(timer)
  }, [addressStep, typed, find])

  const setAddress = useCallback((next: string) => {
    asked.current += 1
    setAddressState({ typed: next, found: null, finding: false })
  }, [])
  const confirmAddress = useCallback(() => {
    const answered = address.found
    if (answered !== null && answered.product !== null) return setAt((was) => was + 1)
    if (typed.trim() === '')
      return setAddressState((was) => ({ ...was, found: { product: null, webUrl: '', reason: 'invalid', tokenPage: null } }))
    find(typed, (now) => {
      if (now.product !== null) setAt((was) => was + 1)
    })
  }, [address.found, find, typed])

  /* ---- Trello's key ---- */
  const option = products.find((candidate) => candidate.product === (instance?.product ?? way?.product))
  const setKey = useCallback((value: string) => setKeyState({ value, error: null }), [])
  const confirmKey = useCallback(() => {
    const value = key.value.trim()
    const wrong = value === '' ? null : option?.keyChecks.find((rule) => new RegExp(rule.pattern).test(value))?.says
    if (value === '') return setKeyState((was) => ({ ...was, error: text.emptyKey }))
    if (wrong !== null && wrong !== undefined) return setKeyState((was) => ({ ...was, error: wrong }))
    setAt((was) => was + 1)
  }, [key.value, option])

  /* ---- the token ---- */
  const setToken = useCallback((value: string) => setTokenState((was) => ({ ...was, value, error: null })), [])
  const setEmail = useCallback((value: string) => setTokenState((was) => ({ ...was, email: value, emailError: null })), [])
  const wantsEmail = option?.tokenNeeds === 'email' && again === null
  const send = useCallback(
    (given: string) => {
      const value = given.trim()
      if (instance === null) return
      if (value === '') return setTokenState((was) => ({ ...was, error: text.emptyToken }))
      if (wantsEmail && email.trim() === '') return setTokenState((was) => ({ ...was, emailError: text.emptyEmail }))
      setTokenState((was) => ({ ...was, saving: true, error: null, emailError: null }))
      setRefused(null)
      client
        .connectToken({
          product: instance.product,
          token: value,
          ...(again === null ? { webUrl: instance.webUrl } : { connectionId: again.id }),
          ...(wantsEmail ? { user: email.trim() } : {}),
          ...(option?.tokenNeeds === 'key' && key.value.trim() !== '' ? { key: key.value.trim() } : {}),
        })
        .then(
          (made) => {
            taken.current = value
            setClip(null)
            setTokenState((was) => ({ ...was, value: '', saving: false }))
            setConnection({ id: made.id, login: made.account.login })
            setCheck(null)
            goTo('check')
          },
          (failure: unknown) => {
            // A token the service didn't take is said on the check, where its account would be.
            if (failure instanceof ApiError && failure.reason === 'ConnectorFailed' && failure.why === 'unauthorized') {
              setTokenState((was) => ({ ...was, saving: false }))
              setRefused(failure.message)
              setCheck(null)
              goTo('check')
              return
            }
            setTokenState((was) => ({ ...was, saving: false, error: messageOf(failure) }))
          },
        )
    },
    [again, client, email, goTo, instance, key.value, option, wantsEmail],
  )
  const submitToken = useCallback(() => send(token.value), [send, token.value])
  const takeClip = useCallback(() => {
    if (clip !== null) send(clip)
  }, [clip, send])

  // While a step waits for a token, the clipboard is read as the window comes back, for one that looks like the service's.
  const prefixes = useMemo(() => option?.tokenPrefixes ?? [], [option])
  const watching = (step === 'make' || step === 'allow' || step === 'paste') && prefixes.length > 0
  useEffect(() => {
    if (!watching) return
    const look = () => {
      host.clipboardToken().then(
        (seen) => {
          if (seen === null || seen === taken.current || !prefixes.some((prefix) => seen.startsWith(prefix))) return
          setClip(seen)
          if (step !== 'paste') goTo('paste')
        },
        () => undefined,
      )
    }
    window.addEventListener('focus', look)
    return () => window.removeEventListener('focus', look)
  }, [watching, host, prefixes, step, goTo])

  const pasteMyself = useCallback(() => goTo('paste'), [goTo])
  const open = useCallback((url: string) => void window.open(url, '_blank'), [])
  const openAndPaste = useCallback(
    (url: string) => {
      window.open(url, '_blank')
      setRefused(null)
      setCheck(null)
      setConnection(null)
      goTo('paste')
    },
    [goTo],
  )

  /* ---- gh's or glab's sign-in ---- */
  const takeCli = useCallback(() => {
    if (way?.cli === undefined) return
    setCli({ busy: true, error: null })
    client.connectCli(way.cli.product, way.cli.webUrl).then(
      (made) => {
        setCli({ busy: false, error: null })
        setConnection({ id: made.id, login: made.account.login })
        goTo('check')
      },
      (failure: unknown) => setCli({ busy: false, error: messageOf(failure) }),
    )
  }, [client, goTo, way])

  /* ---- the service's own sign-in, in the browser ---- */
  const wayUrl = way?.webUrl ?? null
  const wayProduct = way?.product ?? null
  const signingStep = step === 'code' || step === 'approve'
  useEffect(() => {
    if (!signingStep || signIn !== null || flow.current !== null || starting.current || wayProduct === null || wayUrl === null) return
    const start = (starts.current += 1)
    starting.current = true
    client.startSignIn(wayProduct, wayUrl).then(
      (started) => {
        starting.current = false
        if (start !== starts.current) return void client.cancelSignIn(started.flowId).catch(() => undefined)
        flow.current = started.flowId
        const url = started.kind === 'device' ? started.verificationUri : started.url
        setSignIn(
          started.kind === 'device'
            ? { kind: 'device', url, code: started.userCode, expiresAt: started.expiresAt, ended: null }
            : { kind: 'browser', url, code: null, expiresAt: null, ended: null },
        )
        window.open(url, '_blank')
      },
      (failure: unknown) => {
        starting.current = false
        if (start === starts.current) setSignIn({ kind: 'device', url: '', code: null, expiresAt: null, ended: messageOf(failure) })
      },
    )
  }, [client, signingStep, signIn, wayProduct, wayUrl])
  // A sign-in is asked how it stands until it ends.
  useEffect(() => {
    if (!signingStep || signIn === null || signIn.ended !== null) return
    const timer = setInterval(() => {
      const current = flow.current
      if (current === null) return
      client.getSignIn(current).then(
        (state) => {
          if (flow.current !== current || state.state === 'waiting') return
          flow.current = null
          if (state.state === 'ended') return setSignIn((was) => (was === null ? was : { ...was, ended: state.message }))
          setConnection({ id: state.connectionId, login: '' })
          setAt((was) => was + 1)
        },
        (failure: unknown) => {
          flow.current = null
          setSignIn((was) => (was === null ? was : { ...was, ended: messageOf(failure) }))
        },
      )
    }, POLL)
    return () => clearInterval(timer)
  }, [client, signingStep, signIn])
  // One left by stepping away, or by closing the walk, is cancelled; so is one still starting.
  useEffect(() => {
    if (signingStep) return
    starts.current += 1
    cancelFlow()
  }, [signingStep, cancelFlow])
  useEffect(
    () => () => {
      starts.current += 1
      cancelFlow()
    },
    [cancelFlow],
  )
  const retrySignIn = useCallback(() => setSignIn(null), [])

  /* ---- what it can do ---- */
  const connectionId = connection?.id ?? null
  const checkStep = step === 'check' || step === 'install'
  // Asked as the check opens with a connection, and again when the person asks: until the service answers.
  const checking = checkStep && connectionId !== null && check === null && checkError === null && refused === null
  const asking = useRef<string | null>(null)
  const ask = useCallback(
    (id: string, installing: boolean) => {
      asking.current = id
      client.checkConnection(id).then(
        (result) => {
          asking.current = null
          setCheck(result)
          const account = result.lines.find((line) => line.need === 'account')?.fact
          if (account !== null && account !== undefined) setConnection((was) => (was === null ? was : { ...was, login: account }))
          // GitHub's app, not let in to the projects' owner yet: that is the next thing to do.
          const reach = result.lines.find((line) => line.need === 'reach')
          if (reach?.reason?.kind === 'not_installed') goTo('install')
          else if (installing) goTo('check')
        },
        (failure: unknown) => {
          asking.current = null
          setCheckError(messageOf(failure))
        },
      )
      // The list has the new connection.
      void cache.refetchQueries({ queryKey: keys.connections })
    },
    [cache, client, goTo],
  )
  useEffect(() => {
    if (checking && connectionId !== null && asking.current !== connectionId) ask(connectionId, step === 'install')
  }, [checking, connectionId, ask, step])
  // Waiting for GitHub's app to be let in: asked again, a little apart, until it is.
  useEffect(() => {
    if (step !== 'install' || connectionId === null) return
    const timer = setInterval(() => {
      if (asking.current === null) ask(connectionId, true)
    }, INSTALL_POLL)
    return () => clearInterval(timer)
  }, [step, connectionId, ask])
  const checkAgain = useCallback(() => {
    setCheck(null)
    setCheckError(null)
  }, [])

  /* ---- stepping back, and the end ---- */
  const back = useCallback((): boolean => {
    if (way === null) return false
    const previous = at > 0 ? way.steps[at - 1] : undefined
    // A sign-in that finished, or gh's taken, isn't done twice: back from after it is back to the start.
    const startOver =
      previous === undefined || previous === 'code' || previous === 'approve' || previous === 'install' || previous === 'cli'
    if (!startOver) {
      if (step === 'check') {
        setCheck(null)
        setRefused(null)
        setCheckError(null)
      }
      setAt(at - 1)
      return true
    }
    const choosing = chosen !== null && (found.ways.length > 1 || chosen === 'server') && !server
    if (!choosing) return false
    anotherWay()
    return true
  }, [anotherWay, at, chosen, found.ways.length, server, step, way])

  const done = useCallback(() => {
    void cache.refetchQueries({ queryKey: keys.connections })
    onClose()
  }, [cache, onClose])

  return {
    service,
    again,
    guide,
    reading,
    ways: found.ways,
    serverWay: found.server,
    way,
    step,
    at,
    instance,
    option: option ?? null,
    address: { typed, found: address.found, finding: address.finding },
    key,
    token: { ...token, email },
    clip,
    signIn,
    cli,
    connection,
    check,
    checking,
    checkError,
    refused,
    choose,
    chooseServer,
    anotherWay,
    back,
    setAddress,
    confirmAddress,
    setKey,
    confirmKey,
    setToken,
    setEmail,
    submitToken,
    takeClip,
    pasteMyself,
    open,
    openAndPaste,
    takeCli,
    retrySignIn,
    checkAgain,
    done,
  }
}

/** What the view model says itself, where nothing was given. */
export const text = {
  emptyToken: 'Paste the token first',
  emptyEmail: 'Type the email your Atlassian account signs in with',
  emptyKey: 'Paste the Power-Up’s API key first',
}
