import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { chord, CommentBox, keys, PageEmpty, PageFrame, PageLine, PagePanel, type PageViewportOption, primaryDown } from '@althar/ui'

import { shownAddress } from '../../../main/browser/addresses'
import type { CookieKeep } from '../../../main/browser/cookies'
import { DEVICES, placed, type Rect, type Viewport, VIEWPORTS } from '../../../main/browser/devices'
import type { PageLine as Line, Pointed } from '../../../main/browser/page'
import { useServices } from '../../data/services'
import { cropOf, gather, type GatheredComment, rewrite, drop, useComments } from '../../shared/comments'
import { usePreferences } from '../../shared/usePreferences'
import { useCovered } from './cover'
import { pages, usePage, type Where } from './pages'

/*
 * A page beside a conversation, or in a tab of its own (ADR-099): the kit's
 * PagePanel over the page the main process lays where this keeps its place.
 * The place is measured as it moves and is dragged, and sent each frame;
 * while one of the window's own menus or dialogs is over it, or a comment is
 * written on it, a picture of the page shows instead, and the page steps
 * aside. Pointing at the page hands back an element, its crop and a
 * picture; the comment is written here, over that picture, never on the
 * page, and goes in the conversation's composer with the others.
 */

export const text = {
  label: 'Page',
  viewports: {
    fit: 'Fit the panel',
    desktop: 'Desktop',
    laptop: 'Laptop',
    tablet: 'Tablet',
    phone: 'Phone',
  } as Readonly<Record<Viewport, string>>,
  sized: (width: number, height: number) => `${width} × ${height}`,
  keeps: {
    page: 'until the page closes',
    quit: 'until Althar quits',
    task: 'until the task is done',
    site: 'as long as each site asks',
  } as Readonly<Record<CookieKeep, string>>,
  keepsProject: 'until the project is removed',
  taskSession: 'This task’s own session',
  projectSession: 'The project’s own session',
  taskApart: 'Cookies and storage of its own, apart from Althar, your browser and other tasks.',
  projectApart: 'Cookies and storage of its own, apart from Althar, your browser and the tasks.',
  besideTask: 'Back beside the task',
  besideProject: 'Back beside the conversation',
  empty: 'Type an address, or open a link from the conversation.',
  refused: {
    file: 'Files on this computer don’t open here.',
    scheme: 'Only web pages open here.',
    address: 'That isn’t a web address.',
  },
  signIn: (service: string) => `${service}’s sign-in opened in your browser.`,
  asked: (host: string, what: string) => `${host === '' ? 'The page' : host} asked for the ${what}, which pages here don’t get.`,
  outside: 'Open in your browser',
  download: (name: string) => `${name} wasn’t downloaded here.`,
  downloadOutside: 'Download in your browser',
  failed: (host: string) => `${host === '' ? 'The page' : host} didn’t answer.`,
  gone: 'The page stopped.',
  reload: 'Reload',
} as const

const VIEWPORT_OPTIONS: ReadonlyArray<PageViewportOption<Viewport>> = VIEWPORTS.map((value) =>
  value === 'fit'
    ? { value, label: text.viewports.fit }
    : { value, label: text.viewports[value], hint: text.sized(DEVICES[value].width, DEVICES[value].height) },
)

export interface PageViewProps {
  /** The task or project whose conversation the page is beside. */
  owner: string
  kind: 'task' | 'project'
  /** The conversation's draft, where its comments wait. */
  draft: string
  where: Where
  /** Moves it to a tab of its own, or back beside the conversation. */
  onDock: () => void
}

const same = (a: Rect | null, b: Rect | null) =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)

/** What is being written over the page's picture: a new comment on an element pointed at, or one made before, opened again. */
interface Writing {
  readonly pointed: Pointed
  readonly comment: GatheredComment | null
  readonly n: number
}

export function PageView({ owner, kind, draft, where, onDock }: PageViewProps) {
  const { host } = useServices()
  const browser = host.pages
  const { state, reopen } = usePage(owner, browser)
  const { preferences } = usePreferences()
  const navigate = useNavigate()
  const comments = useComments(draft)
  const address = useRef<HTMLInputElement>(null)

  // Where the page goes: the panel's place, as the window lays it out, sent to main whenever it moves.
  const [place, setPlace] = useState<HTMLDivElement | null>(null)
  const [panel, setPanel] = useState<Rect | null>(null)
  const measure = useCallback(() => {
    if (place === null) return
    const box = place.getBoundingClientRect()
    const next = box.width < 1 || box.height < 1 ? null : { x: box.left, y: box.top, width: box.width, height: box.height }
    setPanel((was) => (same(was, next) ? was : next))
  }, [place])
  useEffect(() => {
    if (place === null) return
    const watching = new ResizeObserver(measure)
    watching.observe(place)
    window.addEventListener('resize', measure)
    return () => {
      watching.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [place, measure])
  // Things above it can move it without resizing it, as a line under the bar comes and goes: looked at after each render.
  useLayoutEffect(measure)
  useEffect(() => {
    browser?.show(owner, panel)
  }, [browser, owner, panel])
  // Hidden, as another screen shows or this one is kept aside, the page goes from over the window.
  useEffect(() => () => browser?.show(owner, null), [browser, owner])

  const viewport = state?.viewport ?? 'fit'
  // Where the page is in its place, at a device's size: the main process lays it out the same way.
  const device = useMemo(() => {
    if (panel === null || viewport === 'fit') return null
    const { rect } = placed(panel, viewport)
    return { x: rect.x - panel.x, y: rect.y - panel.y, width: rect.width, height: rect.height }
  }, [panel, viewport])

  const [writing, setWriting] = useState<Writing | null>(null)
  const covered = useCovered(panel, () => document.getElementById('root'))
  const [coveredStill, setCoveredStill] = useState<string | null>(null)
  // Whether the page should be aside now: a picture that finishes drawing after what was over it went must not hide it again.
  const aside = useRef(false)
  useLayoutEffect(() => {
    aside.current = covered || writing !== null
  }, [covered, writing])
  // While something of the window's is over it, or a comment is written on it, a picture shows in its place; the page steps aside once it is drawn.
  useEffect(() => {
    if (browser === undefined) return
    let live = true
    // With no picture of the page, a comment is written over the panel's own ground: the page steps aside at once.
    if (writing !== null && writing.pointed.still === '') void browser.cover(owner, true)
    else if (writing === null && covered)
      void browser
        .still(owner)
        .catch(() => null)
        .then((picture) => {
          if (!live) return
          // With no picture to show, the page steps aside all the same: what is over it must show.
          if (picture === null) void browser.cover(owner, true)
          setCoveredStill(picture)
        })
    else if (writing === null) {
      void browser.cover(owner, false)
      // The picture goes once the page is back over it, so nothing between blinks.
      const frame = requestAnimationFrame(() => setCoveredStill(null))
      return () => {
        live = false
        cancelAnimationFrame(frame)
      }
    }
    return () => {
      live = false
    }
  }, [browser, owner, covered, writing])
  const still = writing === null ? coveredStill : writing.pointed.still === '' ? null : writing.pointed.still
  // Closing or leaving, the page comes back for whoever shows it next.
  useEffect(() => () => void browser?.cover(owner, false), [browser, owner])

  // The comments' pins, each on the page it was made on.
  useEffect(() => {
    void browser?.pins(
      owner,
      comments.map((comment, index) => ({ n: index + 1, selector: comment.on.picked.selector, address: comment.on.address })),
    )
  }, [browser, owner, comments])

  const point = useCallback(async () => {
    if (browser === undefined || state === null || state.address === '') return
    if (state.pointing) return void browser.stopPointing(owner)
    const pointed = await browser.point(owner)
    if (pointed !== null) setWriting({ pointed, comment: null, n: comments.length + 1 })
  }, [browser, owner, state, comments.length])

  // A comment's chip pressed in the composer opens it again here, on its element.
  useEffect(() => {
    if (reopen === null || browser === undefined || panel === null || writing !== null) return
    const id = pages.takeReopen(owner)
    const index = comments.findIndex((one) => one.id === id)
    const comment = comments[index]
    if (comment === undefined) return
    void (async () => {
      const found = await browser.find(owner, comment.on.picked.selector, comment.on.address)
      if (found !== null) return setWriting({ pointed: found, comment, n: index + 1 })
      // Gone from the page: the comment opens over the page as it is, at its top, to change or remove.
      const picture = (await browser.still(owner)) ?? ''
      setWriting({
        pointed: {
          picked: comment.on.picked,
          crop: null,
          cropSize: null,
          still: picture,
          scale: 1,
          at: { x: 16, y: 16, width: 0, height: 0 },
          address: comment.on.address,
          viewport: comment.on.viewport,
        },
        comment,
        n: index + 1,
      })
    })()
  }, [reopen, browser, owner, panel, writing, comments])

  const submit = async (note: string) => {
    if (writing === null) return
    const { pointed, comment, n } = writing
    setWriting(null)
    const on = { kind: 'page' as const, picked: pointed.picked, address: pointed.address, viewport: pointed.viewport }
    // A crop that can't be read goes without; the comment never does.
    const crop = pointed.crop === null ? null : await cropOf(pointed.crop, n).catch(() => null)
    if (comment === null) gather(draft, { id: crypto.randomUUID(), note, on, crop })
    else rewrite(draft, comment.id, note, pointed.crop === null ? undefined : { on, crop })
  }

  // In the page, the keys the window acts on: Comment, and the address.
  useEffect(
    () =>
      browser?.onKey((from, key) => {
        if (from !== owner) return
        if (key === 'comment') void point()
        if (key === 'address') address.current?.focus()
      }),
    [browser, owner, point],
  )
  // In the window, Comment's own key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!primaryDown(event) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'c') return
      event.preventDefault()
      void point()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [point])

  if (browser === undefined) return null
  const keep = preferences.browserCookies
  const empty = (state === null || state.address === '') && state?.line == null
  const room = panel === null ? { width: 0, height: 0 } : { width: panel.width, height: panel.height }
  const offset = device === null ? { x: 0, y: 0 } : { x: device.x, y: device.y }
  return (
    <PagePanel<Viewport>
      address={state === null ? '' : shownAddress(state.address)}
      full={state?.address ?? ''}
      loading={state?.loading === true}
      canBack={state?.back === true}
      canForward={state?.forward === true}
      onBack={() => void browser.move(owner, 'back')}
      onForward={() => void browser.move(owner, 'forward')}
      onReload={() => void browser.move(owner, 'reload')}
      onStop={() => void browser.move(owner, 'stop')}
      onNavigate={(typed) => void browser.open(owner, typed).then((opened) => opened !== null && pages.known(opened))}
      addressRef={address}
      keep={kind === 'project' && keep === 'task' ? text.keepsProject : text.keeps[keep]}
      onChangeKeep={() => void navigate({ to: '/settings/$section', params: { section: 'browser' } })}
      onClear={() => void browser.clear(owner)}
      viewport={viewport}
      viewports={VIEWPORT_OPTIONS}
      onViewport={(value) => void browser.viewport(owner, value)}
      {...(state === null || state.address === ''
        ? {}
        : { onComment: () => void point(), onOutside: () => void browser.outside(owner, 'page') })}
      pointing={state?.pointing === true}
      commentKey={chord(keys.mod, keys.shift, 'C')}
      docked={where}
      onDock={onDock}
      onClose={() => {
        setWriting(null)
        pages.forget(owner)
        void browser.close(owner)
      }}
      line={state?.line == null ? null : <LineOf line={state.line} owner={owner} />}
      text={{
        label: text.label,
        sessionTitle: kind === 'task' ? text.taskSession : text.projectSession,
        sessionApart: kind === 'task' ? text.taskApart : text.projectApart,
        beside: kind === 'task' ? text.besideTask : text.besideProject,
      }}
    >
      <PageFrame
        placeRef={setPlace}
        page={device}
        still={still}
        onStill={() => {
          if (aside.current) void browser.cover(owner, true)
        }}
        {...(empty ? { empty: <PageEmpty>{text.empty}</PageEmpty> } : {})}
      >
        {writing !== null && (
          <CommentBox
            key={`${writing.comment?.id ?? 'new'}:${writing.n}`}
            at={{
              x: offset.x + writing.pointed.at.x,
              y: offset.y + writing.pointed.at.y,
              width: writing.pointed.at.width,
              height: writing.pointed.at.height,
            }}
            room={room}
            n={writing.n}
            element={writing.pointed.picked.label}
            size={text.sized(writing.pointed.picked.rect.width, writing.pointed.picked.rect.height)}
            defaultValue={writing.comment?.note ?? ''}
            existing={writing.comment !== null}
            onSubmit={(note) => void submit(note)}
            onCancel={() => setWriting(null)}
            {...(writing.comment === null
              ? {}
              : {
                  onRemove: () => {
                    if (writing.comment !== null) drop(draft, writing.comment.id)
                    setWriting(null)
                  },
                })}
          />
        )}
      </PageFrame>
    </PagePanel>
  )
}

/** The line under the bar, in words, with what can be done about it. */
function LineOf({ line, owner }: { line: Line; owner: string }) {
  const browser = useServices().host.pages
  if (browser === undefined) return null
  const dismiss = () => void browser.dismiss(owner)
  switch (line.kind) {
    case 'refused':
      return (
        <PageLine icon="stop" onDismiss={dismiss}>
          {text.refused[line.refusal]}
        </PageLine>
      )
    case 'sign-in':
      return (
        <PageLine icon="external" onDismiss={dismiss}>
          {text.signIn(line.service)}
        </PageLine>
      )
    case 'asked':
      return (
        <PageLine icon="session" action={{ label: text.outside, onAction: () => void browser.outside(owner, 'page') }} onDismiss={dismiss}>
          {text.asked(line.host, line.asked)}
        </PageLine>
      )
    case 'download':
      return (
        <PageLine
          icon="download"
          {...(line.offered ? { action: { label: text.downloadOutside, onAction: () => void browser.outside(owner, 'download') } } : {})}
          onDismiss={dismiss}
        >
          {text.download(line.name)}
        </PageLine>
      )
    case 'failed':
      return (
        <PageLine icon="offline" action={{ label: text.reload, onAction: () => void browser.move(owner, 'reload') }} onDismiss={dismiss}>
          {text.failed(line.host)}
        </PageLine>
      )
    case 'gone':
      return (
        <PageLine icon="stop" action={{ label: text.reload, onAction: () => void browser.move(owner, 'reload') }}>
          {text.gone}
        </PageLine>
      )
  }
}
