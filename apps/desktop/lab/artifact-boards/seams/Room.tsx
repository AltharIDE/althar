import { useEffect, useRef, useState } from 'react'

import { Artifacts, Button, Icon, Markdown, Menu, MenuItem, Segmented, You } from '@althar/ui'

import { agoWords, ARTIFACTS, type Artifact, artifactOf, type ArtifactKind, boardCount, CANVAS_KIND, GIFT, KIND_WORDS } from '../artifacts'
import { GIFT_SO_FAR } from '../data'
import { ask, boardKey, boardsOf, live, type Spot, useLive } from '../live'
import { type Moment, momentOf } from '../moments'
import { ArtifactCanvas } from '../parts/ArtifactCanvas'
import { Boards, type Pointed, type View } from '../parts/Boards'
import { PinCard, PinMarks } from '../parts/Pins'
import { Say } from '../parts/Say'
import { Keep, Where } from '../parts/Keep'
import { Share } from '../parts/Share'
import { Thumb } from '../parts/Thumb'
import { roundOf, useLab, useOpenSoon } from '../state'
import { Panel } from './Host'
import r from './room.module.css'

/*
 * The lab's Artifacts room (in place of features/canvases/ArtifactsView, in
 * the project's view). B: a gallery of every artifact, each a live picture,
 * and one opened takes the room, its conversation docked beside it. C: the
 * wall, every artifact's boards on one canvas. A and D keep today's table,
 * and an artifact opened from it is the canvas they put beside a
 * conversation, as wide as the room.
 */

export function ArtifactsView(_: { projectId: string; threadId: string | null; draft: string | null }) {
  const { d, m } = useLab()
  const moment = momentOf(d, m)
  const key = String(roundOf())
  if (d === 'b') return <Gallery key={key} moment={moment} />
  if (d === 'c') return <Wall key={key} moment={moment} />
  return <Table key={key} talk={d === 'd' ? 'pin' : 'conversation'} />
}

/* ——— A, D: today's table ——— */

function Table({ talk }: { talk: 'conversation' | 'pin' }) {
  const [open, setOpen] = useState<string | null>(null)
  const now = Date.now()
  return (
    <Artifacts
      canvases={ARTIFACTS.map((one) => ({
        id: one.id,
        name: one.name,
        title: one.title,
        kind: CANVAS_KIND[one.kind],
        version: live.version(one),
        by: one.by,
        when: agoWords(one.ago),
        at: new Date(now - one.ago * 60_000).toISOString(),
        openComments: one.comments,
      }))}
      onOpen={(row) => setOpen(row.id)}
      open={open !== null && <Panel key={open} canvasId={open} talk={talk} moment={{ opening: {} }} onClose={() => setOpen(null)} />}
    />
  )
}

/* ——— B: a gallery, and an artifact's own room ——— */

const TASK_ORDER = ['Gift a class', 'Bigger photos on Classes', 'A calmer checkout', null] as const

function Gallery({ moment }: { moment: Moment }) {
  const [open, setOpen] = useState<string | null>(moment.open ?? null)
  const [kind, setKind] = useState<ArtifactKind | 'all'>('all')
  const [order, setOrder] = useState<'newest' | 'task'>('newest')
  const [place, setPlace] = useState<'anywhere' | 'git' | 'althar'>('anywhere')
  const [words, setWords] = useState('')
  if (open !== null) return <ArtifactRoom id={open} moment={moment} onBack={() => setOpen(null)} />
  const said = words.trim().toLowerCase()
  const shown = ARTIFACTS.filter(
    (one) =>
      (kind === 'all' || one.kind === kind) &&
      (place === 'anywhere' || (live.keptOf(one) !== null) === (place === 'git')) &&
      (said === '' || `${one.title} ${one.name} ${one.by} ${live.keptOf(one)?.path ?? ''}`.toLowerCase().includes(said)),
  )
  const groups =
    order === 'newest'
      ? [{ name: null as string | null, artifacts: [...shown].sort((a, b) => a.ago - b.ago) }]
      : [
          ...TASK_ORDER.map((task) => ({
            name: task === null ? 'The coordinator' : task,
            artifacts: shown.filter((one) => one.task === task && one.found !== true),
          })),
          { name: 'Found in git', artifacts: shown.filter((one) => one.found === true) },
        ].filter((one) => one.artifacts.length > 0)
  return (
    <div className={r.gallery}>
      <header className={r.galleryHead}>
        <h1 className={r.heading}>Artifacts</h1>
        <span className={r.count}>{shown.length}</span>
        <span className={r.gap} />
        <label className={r.search}>
          <Icon name="search" size={13} />
          <input
            value={words}
            placeholder="Find an artifact"
            aria-label="Find an artifact"
            onChange={(event) => setWords(event.target.value)}
          />
        </label>
        <Segmented
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'design', label: 'Designs' },
            { value: 'diagram', label: 'Diagrams' },
            { value: 'document', label: 'Documents' },
            { value: 'chart', label: 'Charts' },
          ]}
        />
        <Segmented
          label="Where it lives"
          value={place}
          onChange={setPlace}
          options={[
            { value: 'anywhere', label: 'Anywhere' },
            { value: 'git', label: 'In git' },
            { value: 'althar', label: 'Only in Althar' },
          ]}
        />
        <Segmented
          label="Order"
          value={order}
          onChange={setOrder}
          options={[
            { value: 'task', label: 'By task' },
            { value: 'newest', label: 'Newest' },
          ]}
        />
      </header>
      <div className={r.galleryBody}>
        {groups.map((group) => (
          <section key={group.name ?? 'all'} className={r.group}>
            {group.name !== null && <h2 className={r.groupName}>{group.name}</h2>}
            <div className={r.grid}>
              {group.artifacts.map((one) => (
                <button key={one.id} type="button" className={r.card} onClick={() => setOpen(one.id)}>
                  <Thumb artifact={one} className={r.cardThumb} />
                  <span className={r.cardWords}>
                    <span className={r.cardTitle}>{one.title}</span>
                    <span className={r.cardFacts}>
                      {KIND_WORDS[one.kind]}
                      {one.kind === 'design'
                        ? ` · ${one.pages.length > 1 ? `${one.pages.length} pages, ` : ''}${boardCount(one)} boards`
                        : ''}
                    </span>
                    <span className={r.cardFacts}>
                      v{live.version(one)} · {order === 'newest' ? `${one.by} · ` : ''}
                      {agoWords(one.ago)}
                      {one.comments > 0 && (
                        <span className={r.cardComments}>
                          <Icon name="comment" size={11} /> {one.comments}
                        </span>
                      )}
                    </span>
                    <Where artifact={one} className={r.cardWhere} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/** An artifact with the room to itself: its canvas, and the conversation with the lead that drew it, docked beside. */
function ArtifactRoom({ id, moment, onBack }: { id: string; moment: Moment; onBack: () => void }) {
  const artifact = artifactOf(id)
  const [sharing, setSharing] = useOpenSoon(moment.share === true && id === moment.open)
  const version = live.version(artifact)
  useLive()
  return (
    <div className={r.room}>
      <header className={r.roomHead}>
        <button type="button" className={r.back} onClick={onBack}>
          <Icon name="chevronL" size={12} />
          Artifacts
        </button>
        <span className={r.crumb}>/</span>
        <span className={r.roomTitle}>{artifact.title}</span>
        <Menu
          label="Versions"
          trigger={
            <button type="button" className={r.version}>
              v{version}
            </button>
          }
        >
          {Array.from({ length: version }, (_, i) => version - i).map((one) => (
            <MenuItem key={one} hint={one === version ? 'Latest' : undefined} onSelect={() => undefined}>
              Version {one}
            </MenuItem>
          ))}
        </Menu>
        <span className={r.gap} />
        <Keep artifact={artifact} />
        <Share title={artifact.title} slug={artifact.name} tone="head" open={sharing} onOpenChange={setSharing} />
      </header>
      <div className={r.roomBody}>
        <Talk artifact={artifact} />
        <ArtifactCanvas artifact={artifact} talk="conversation" opening={id === moment.open ? moment.opening : {}} />
      </div>
    </div>
  )
}

/** The conversation docked beside an artifact: its task's, from the first ask; what is said here is said there. */
function Talk({ artifact }: { artifact: Artifact }) {
  const world = useLive()
  const [words, setWords] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const gift = artifact.id === GIFT
  const before: ReadonlyArray<{ readonly who: 'you' | 'lead' | 'canvas'; readonly text: string }> = artifact.found
    ? []
    : gift
      ? GIFT_SO_FAR.map((one) =>
          one.who === 'canvas' ? { who: 'canvas' as const, text: `v${one.version} · ${one.note}` } : { who: one.who, text: one.text },
        )
      : [
          { who: 'you' as const, text: `${artifact.task ?? 'This'}.` },
          { who: 'lead' as const, text: `${artifact.title} is on the canvas, ${boardCount(artifact)} boards.` },
        ]
  const lines = [...before, ...world.lines.map((one) => ({ who: one.who, text: one.text }))]
  useEffect(() => {
    const box = end.current?.parentElement
    if (box != null) box.scrollTop = box.scrollHeight
  }, [lines.length, world.working])
  const said = words.trim()
  const send = () => {
    if (said === '') return
    const page = artifact.pages[0]
    const board = page?.boards[0]
    if (page === undefined || board === undefined) return
    const spot: Spot = {
      artifactId: artifact.id,
      boardId: board.id,
      selector: null,
      label: 'The whole board',
      box: { x: 0, y: 0, width: 0, height: 0 },
      part: null,
    }
    ask(artifact, board, page.id, spot, said)
    setWords('')
  }
  return (
    <section className={r.talk} aria-label={`Talking about ${artifact.title}`}>
      <div className={r.talkHead}>
        <span className={r.talkWho}>
          {artifact.found ? `${artifact.by} committed it ${agoWords(artifact.ago)}` : `Lead of ${artifact.task ?? 'the coordinator’s'}`}
        </span>
        {!artifact.found && (
          <button type="button" className={r.talkTask}>
            Open the task
            <Icon name="arrow" size={11} />
          </button>
        )}
      </div>
      <div className={r.lines}>
        {lines.map((line, i) =>
          line.who === 'you' ? (
            <You key={i} className={r.you}>
              {line.text}
            </You>
          ) : line.who === 'canvas' ? (
            <div key={i} className={r.canvasLine}>
              <Icon name="canvas" size={12} />
              {line.text}
            </div>
          ) : (
            <div key={i} className={r.lead}>
              <Markdown source={line.text} size="panel" />
            </div>
          ),
        )}
        {world.working && <div className={r.working}>Changing it on the canvas</div>}
        <div ref={end} />
      </div>
      <div className={r.compose}>
        <textarea
          className={r.composeField}
          rows={2}
          value={words}
          placeholder={`Say something about ${artifact.title}`}
          aria-label="Message"
          onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className={r.composeFoot}>
          <span className={r.composeHint}>
            {artifact.found ? 'Saying something starts a task on it' : 'Or point at a part on the canvas'}
          </span>
          <Button size="small" variant="signal" disabled={said === ''} onClick={send}>
            Send
          </Button>
        </div>
      </div>
    </section>
  )
}

/* ——— C: the wall ——— */

function Wall({ moment }: { moment: Moment }) {
  const world = useLive()
  const [opened, setOpened] = useState<string | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(moment.picked ?? []))
  const [view, setView] = useState<View>('every')
  const [focus, setFocus] = useState<string | null>(null)
  const [pointed, setPointed] = useState<Pointed | null>(null)
  const [pin, setPin] = useState<string | null>(null)
  const [sharing, setSharing] = useOpenSoon(moment.share === true)
  if (opened !== null) return <ArtifactRoom id={opened} moment={{ opening: {} }} onBack={() => setOpened(null)} />
  const sections = ARTIFACTS.map((one) => {
    const page = one.pages[0]?.id ?? ''
    return {
      key: one.id,
      artifact: one,
      pageId: page,
      boards: boardsOf(world, one, page),
      heading: {
        title: one.title,
        facts: `${KIND_WORDS[one.kind]} · ${one.pages.length > 1 ? `${one.pages.length} pages · ` : ''}${one.by} · ${agoWords(one.ago)}${
          live.keptOf(one) === null ? '' : ` · in ${live.keptOf(one)?.repo}/${live.keptOf(one)?.path}`
        }`,
        onOpen: () => setOpened(one.id),
      },
    }
  })
  const openPin = world.pins.find((one) => one.id === pin) ?? null
  return (
    <div className={r.wall}>
      <Boards
        sections={sections}
        view={view}
        onView={setView}
        focus={focus}
        onFocus={setFocus}
        selected={picked}
        onSelect={(key) =>
          setPicked((was) => {
            const next = new Set(was)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
          })
        }
        fitKey="wall"
        head={
          picked.size > 0 && (
            <span className={r.picked}>
              <span className={r.pickedWords}>{picked.size === 1 ? '1 board picked' : `${picked.size} boards picked`}</span>
              <Share title="kiln" slug="picked" boards={picked.size} tone="head" open={sharing} onOpenChange={setSharing} />
              <button type="button" className={r.clear} onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </span>
          )
        }
        onPoint={(found) => {
          setPin(null)
          setPointed(found)
        }}
        pointed={pointed}
        box={
          pointed !== null && (
            <Say
              key={`${pointed.key}|${pointed.spot.selector ?? ''}`}
              pointed={pointed}
              to={`To the lead of ${pointed.placed.section.artifact.task ?? 'the coordinator'}, in its conversation`}
              onSend={(words) => {
                ask(pointed.placed.section.artifact, pointed.placed.def, pointed.placed.section.pageId, pointed.spot, words)
                setPointed(null)
              }}
              onComment={(words) => {
                live.pin({
                  id: `pin-${Date.now().toString(36)}`,
                  spot: pointed.spot,
                  who: 'you',
                  lines: [{ who: 'you', text: words }],
                  state: 'comment',
                })
                setPointed(null)
              }}
              onClose={() => setPointed(null)}
            />
          )
        }
        marks={(at, _placed, room) => {
          const shown =
            openPin === null ? null : at(boardKey(openPin.spot.artifactId, openPin.spot.boardId), openPin.spot.selector ?? openPin.spot.box)
          const artifact = openPin === null ? null : artifactOf(openPin.spot.artifactId)
          const board = artifact?.pages.flatMap((one) => one.boards).find((one) => one.id === openPin?.spot.boardId)
          return (
            <>
              <PinMarks at={at} pins={world.pins} open={pin} onOpen={setPin} />
              {openPin !== null && shown !== null && artifact !== null && board !== undefined && (
                <div
                  className={r.pinPlace}
                  style={{
                    left: Math.min(shown.x + shown.width + 24, room.width - 356),
                    top: Math.max(56, Math.min(shown.y - 14, room.height - 460)),
                  }}
                >
                  <PinCard
                    pin={openPin}
                    board={board.name}
                    talk="conversation"
                    onAsk={(words) => ask(artifact, board, artifact.pages[0]?.id ?? '', openPin.spot, words)}
                    onClose={() => setPin(null)}
                  />
                </div>
              )}
            </>
          )
        }}
        labelEnd={(p) => (
          <button type="button" className={r.openOne} onClick={() => setOpened(p.section.artifact.id)}>
            Open
          </button>
        )}
      />
    </div>
  )
}
