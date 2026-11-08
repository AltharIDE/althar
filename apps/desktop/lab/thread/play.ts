import { useEffect, useState } from 'react'

import type { ThreadItem } from '@althar/contracts'

import type { Streamed } from '../../src/renderer/shared/thread'
import { items } from '../../tests/fixtures'

/*
 * An agent's turn played as the runtime streams it: its text grows in
 * whole copies at most every 50 ms (Sessions.ts, STREAM_EVERY), at about
 * the pace a model writes, with the stalls a provider's stream has, after
 * which what came meanwhile arrives at once; the store's copy of the item
 * catches up every few hundred characters, and holds it all once the item
 * ends. Tool calls start, run a while and end; a lead hands in its report as
 * a step's result. The turn loops.
 */

export type Beat =
  | { readonly think: string }
  /** What it says: its answer, or a word on the way, where its agent says which (Codex). */
  | { readonly say: string; readonly answer?: boolean }
  | { readonly tool: string; readonly kind: string; readonly path?: string; readonly command?: string; readonly ms: number }
  | { readonly pause: number }
  | { readonly report: string }

export interface Played {
  readonly items: ReadonlyArray<ThreadItem>
  readonly streaming: ReadonlyMap<string, Streamed>
  readonly running: boolean
  readonly turnStarted: string | null
  readonly turnEnded: string | null
}

/** Characters a second while the model writes; how often the runtime sends what it has. */
const PACE = 320
const EVERY = 50
/** The chance a beat of the stream stalls, and how long a stall lasts. */
const STALL = { chance: 0.1, min: 250, max: 900 }
/** How often the store's copy catches up, in characters. */
const STORED_EVERY = 400

let made = 0

/** A seeded random, so each run of the page streams the same way. */
const seeded = (seed: number) => () => {
  seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296
  return seed / 4_294_967_296
}

const sleep = (ms: number, stopped: () => boolean) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms)
    if (stopped()) {
      clearTimeout(id)
      resolve()
    }
  })

/**
 * Plays a turn of `agentId`'s after `before`, as `beats` say, again and again
 * until the page leaves; `asked` opens each turn, as what the person asked.
 */
export const usePlayed = (
  before: ReadonlyArray<ThreadItem>,
  asked: string,
  agentId: string,
  model: string,
  beats: ReadonlyArray<Beat>,
  seed = 7,
): Played => {
  const [played, setPlayed] = useState<Played>({ items: before, streaming: new Map(), running: false, turnStarted: null, turnEnded: null })
  useEffect(() => {
    if (beats.length === 0) return
    let gone = false
    const stopped = () => gone
    const random = seeded(seed)
    const mine = (item: ThreadItem): ThreadItem => {
      made += 1
      return { ...item, id: `live${made}`, sequence: 10_000 + made, createdAt: new Date().toISOString(), model }
    }
    void (async () => {
      while (!gone) {
        let thread: Array<ThreadItem> = [...before, { ...mine(items.you(asked)), agentId: null }]
        let streaming = new Map<string, Streamed>()
        const turnStarted = new Date().toISOString()
        const show = (running = true) =>
          setPlayed({ items: thread, streaming, running, turnStarted, turnEnded: running ? null : new Date().toISOString() })
        show()
        // A model takes a moment before its first word: the reply's place shows it thinking meanwhile.
        await sleep(2000, stopped)
        for (const beat of beats) {
          if (gone) return
          if ('pause' in beat) {
            await sleep(beat.pause, stopped)
            continue
          }
          if ('report' in beat) {
            thread = [...thread, mine(items.step({ summary: beat.report, agentId }))]
            show()
            await sleep(300, stopped)
            continue
          }
          if ('tool' in beat) {
            const call = mine(
              items.tool(
                {
                  title: beat.tool,
                  toolKind: beat.kind,
                  status: 'in_progress',
                  command: beat.command ?? null,
                  locations: beat.path === undefined ? [] : [{ path: beat.path }],
                },
                agentId,
              ),
            )
            thread = [...thread, call]
            show()
            await sleep(beat.ms, stopped)
            thread = thread.map((item) =>
              item.id === call.id && item.kind === 'tool_call'
                ? { ...item, content: { ...item.content, status: 'completed', exit: beat.command === undefined ? null : 0 } }
                : item,
            )
            show()
            continue
          }
          const kind = 'think' in beat ? ('agent_thought' as const) : ('agent_message' as const)
          const whole = 'think' in beat ? beat.think : beat.say
          const answer = 'say' in beat ? beat.answer : undefined
          const said = items.says('', agentId)
          const first = mine(
            kind === 'agent_thought'
              ? items.thinks('', agentId)
              : answer === undefined
                ? said
                : ({ ...said, content: { text: '', pictures: [], files: [], answer } } as ThreadItem),
          )
          let sent = 0
          let stored = 0
          let placed = false
          while (sent < whole.length && !gone) {
            const stall = random() < STALL.chance ? STALL.min + random() * (STALL.max - STALL.min) : 0
            const wait = EVERY + stall
            await sleep(wait, stopped)
            sent = Math.min(whole.length, sent + Math.max(1, Math.round((PACE * wait) / 1000 + (random() - 0.5) * 8)))
            const text = whole.slice(0, sent)
            // The item is placed with its first words; the store's copy catches up every so often.
            if (!placed || sent - stored >= STORED_EVERY) {
              stored = sent
              const item = { ...first, content: { ...first.content, text } } as ThreadItem
              thread = placed ? thread.map((one) => (one.id === first.id ? item : one)) : [...thread, item]
              placed = true
            }
            streaming = new Map(streaming).set(first.id, { kind, agentId, text, sequence: first.sequence, at: first.createdAt })
            show()
          }
          // Once it ends, the store holds all of it, and nothing of it streams.
          thread = thread.map((one) =>
            one.id === first.id ? ({ ...first, content: { ...first.content, text: whole } } as ThreadItem) : one,
          )
          streaming = new Map(streaming)
          streaming.delete(first.id)
          show()
        }
        show(false)
        await sleep(6_000, stopped)
      }
    })()
    return () => {
      gone = true
    }
  }, [before, asked, agentId, model, beats, seed])
  return played
}
