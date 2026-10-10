import { QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectList, ThreadSnapshot } from '@althar/contracts'

import { follow, GATHER } from '../src/renderer/data/feed'
import { continued, homeSince, keys, makeQueryClient, readFirst, reads, recheckStatus } from '../src/renderer/data/reads'
import { changed, coordinatorSnapshot, fakeClient, items, project, snapshot, status, streamed } from './fixtures'

/*
 * The window's cache and its one watch: what a change ends, read again
 * gathered or only marked, a read under way when a change came read once
 * more, and the screens hearing every change from when they listen.
 */

beforeEach(() => void vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => void vi.useRealTimers())

const settle = () => vi.advanceTimersByTimeAsync(GATHER + 10)

const opened = () => {
  const fake = fakeClient()
  const cache = makeQueryClient()
  const feed = follow(fake.client, cache, 7)
  const read = reads(fake.client)
  return { ...fake, cache, feed, read }
}

/** A promise settled from outside, for a read still on its way. */
const later = <A>() => {
  let settleWith: (value: A) => void = () => undefined
  const promise = new Promise<A>((resolve) => (settleWith = resolve))
  return { promise, resolve: (value: A) => settleWith(value) }
}

describe('the window’s watch', () => {
  it('watches from where the window started, and passes every change to whoever listens, from then on', () => {
    const { feed, emit, watching } = opened()
    expect(watching).toEqual([7])
    const heard: Array<string> = []
    emit(changed('task', 't0'))
    const stop = feed.listen((event) =>
      heard.push(event._tag === 'Changed' ? event.aggregateId : event._tag === 'Streaming' ? event.itemId : event._tag),
    )
    emit(changed('task', 't1'))
    emit(streamed('i1', 'Hi'))
    stop()
    emit(changed('task', 't2'))
    expect(heard).toEqual(['t1', 'i1'])
  })

  it('reads again what a change ends, gathered, on screen or not; and nothing else', async () => {
    const { client, cache, emit, read } = opened()
    await Promise.all([
      cache.fetchQuery(read.projects()),
      cache.fetchQuery(read.home()),
      cache.fetchQuery(read.board('p1')),
      cache.fetchQuery(read.board('p2')),
      cache.fetchQuery(read.connections()),
    ])
    // A burst of changes to a task in p1 reads each once.
    emit(changed('task', 't1', 'th1', 'p1'))
    emit(changed('run', 'r1', 'th1', 'p1'))
    emit(changed('provider_session', 's1', 'th1', 'p1'))
    await settle()
    expect(client.listProjects).toHaveBeenCalledTimes(2)
    expect(client.getHome).toHaveBeenCalledTimes(2)
    expect(client.getBoard).toHaveBeenCalledTimes(3)
    expect(vi.mocked(client.getBoard).mock.calls.filter(([id]) => id === 'p2')).toHaveLength(1)
    expect(client.listConnections).toHaveBeenCalledTimes(1)

    // What is said in a thread changes none of them.
    emit(changed('thread_item', 'i1', 'th1', 'p1'))
    await settle()
    expect(client.listProjects).toHaveBeenCalledTimes(2)
    expect(client.getBoard).toHaveBeenCalledTimes(3)

    // A connection reads the connections again.
    emit(changed('connection', 'c1', null, null))
    await settle()
    expect(client.listConnections).toHaveBeenCalledTimes(2)
  })

  it('reads the home again for a permission the rules answered only while it shows; off screen, on its next visit', async () => {
    const { client, cache, emit, read } = opened()
    await cache.fetchQuery(read.home())
    emit(changed('decision', 'd1', 'th1', 'p1'))
    await settle()
    expect(client.getHome).toHaveBeenCalledTimes(1)
    expect(cache.getQueryState(keys.home)?.isInvalidated).toBe(true)
    // Gathered with a change that moves more of it, it is read off screen too.
    emit(changed('decision', 'd2', 'th1', 'p1'))
    emit(changed('task', 't1', 'th1', 'p1'))
    await settle()
    expect(client.getHome).toHaveBeenCalledTimes(2)
    // While the home shows, it is read at once.
    const showing = new QueryObserver(cache, read.home())
    const stop = showing.subscribe(() => undefined)
    emit(changed('decision', 'd3', 'th1', 'p1'))
    await settle()
    expect(client.getHome).toHaveBeenCalledTimes(3)
    stop()
  })

  it('marks a thread out of date for its next visit, without reading it now', async () => {
    const { client, cache, emit, read } = opened()
    await cache.fetchQuery(read.thread('th1'))
    await cache.fetchQuery(read.thread('th2'))
    emit(changed('thread_item', 'i1', 'th1'))
    await settle()
    expect(cache.getQueryState(keys.thread('th1'))?.isInvalidated).toBe(true)
    expect(cache.getQueryState(keys.thread('th2'))?.isInvalidated).toBe(false)
    expect(client.getThread).toHaveBeenCalledTimes(2)
    // The next visit reads it, and it is current again.
    await cache.fetchQuery(read.thread('th1'))
    expect(client.getThread).toHaveBeenCalledTimes(3)
    expect(cache.getQueryState(keys.thread('th1'))?.isInvalidated).toBe(false)
  })

  it('marks a coordinator by its own thread, its project’s cards, and any connection', async () => {
    const { cache, emit, read } = opened()
    await cache.fetchQuery(read.coordinator('p1'))
    const state = () => cache.getQueryState(keys.coordinator('p1'))
    const marks = (event: ReturnType<typeof changed>) => {
      cache.setQueryData(keys.coordinator('p1'), cache.getQueryData(keys.coordinator('p1')))
      expect(state()?.isInvalidated).toBe(false)
      emit(event)
      return state()?.isInvalidated
    }
    expect(marks(changed('thread_item', 'i1', coordinatorSnapshot().threadId))).toBe(true)
    expect(marks(changed('run', 'r1', 'th9', 'p1'))).toBe(true)
    expect(marks(changed('connection', 'c1', null, null))).toBe(true)
    expect(marks(changed('run', 'r1', 'th9', 'p2'))).toBe(false)
    expect(marks(changed('thread_item', 'i1', 'th9', 'p1'))).toBe(false)
  })

  it('reads a project’s repositories again only while they show, and marks its threads when it is renamed', async () => {
    const { client, cache, emit, read } = opened()
    // A task on screen reads its project's new name at once.
    const onScreen = new QueryObserver(cache, read.thread('th1'))
    const watching = onScreen.subscribe(() => undefined)
    await vi.waitFor(() => expect(cache.getQueryData(keys.thread('th1'))).toBeDefined())
    emit(changed('project', 'p1', null, 'p1'))
    await vi.waitFor(() => expect(client.getThread).toHaveBeenCalledTimes(2))
    watching()
    await cache.fetchQuery(read.repositories('p1'))
    await cache.fetchQuery(read.thread('th1'))
    await cache.fetchQuery(read.coordinator('p1'))
    const showing = new QueryObserver(cache, read.repositories('p1'))
    const stop = showing.subscribe(() => undefined)
    emit(changed('project', 'p1', null, 'p1'))
    await settle()
    expect(client.getRepositories).toHaveBeenCalledTimes(2)
    // The thread and the coordinator say the project's name: read again on their next visit.
    expect(cache.getQueryState(keys.thread('th1'))?.isInvalidated).toBe(true)
    expect(cache.getQueryState(keys.coordinator('p1'))?.isInvalidated).toBe(true)
    // Another project's change touches neither.
    cache.setQueryData(keys.thread('th1'), cache.getQueryData(keys.thread('th1')))
    emit(changed('project', 'p2', null, 'p2'))
    await settle()
    expect(cache.getQueryState(keys.thread('th1'))?.isInvalidated).toBe(false)
    expect(client.getRepositories).toHaveBeenCalledTimes(2)
    stop()
    // Off screen, a task made in it marks them for the next visit.
    emit(changed('task', 't1', 'th1', 'p1'))
    await settle()
    expect(client.getRepositories).toHaveBeenCalledTimes(2)
    expect(cache.getQueryState(keys.repositories('p1'))?.isInvalidated).toBe(true)
  })

  it('reads a project’s rules again when they change, as an answer kept as a rule changes them, only while they show', async () => {
    const { client, cache, emit, read } = opened()
    await cache.fetchQuery(read.rules('p1'))
    const showing = new QueryObserver(cache, read.rules('p1'))
    const stop = showing.subscribe(() => undefined)
    emit(changed('policy', 'pol1', null, 'p1'))
    await settle()
    expect(client.getProjectRules).toHaveBeenCalledTimes(2)
    stop()
    emit(changed('policy', 'pol2', null, 'p1'))
    await settle()
    expect(client.getProjectRules).toHaveBeenCalledTimes(2)
    expect(cache.getQueryState(keys.rules('p1'))?.isInvalidated).toBe(true)
  })

  it('reads once more what was being read when a change touched it', async () => {
    const { client, cache, emit, read } = opened()
    const first = later<ProjectList>()
    vi.mocked(client.listProjects).mockImplementationOnce(() => first.promise)
    const reading = cache.fetchQuery(read.projects())
    emit(changed('project', 'p1', null, 'p1'))
    first.resolve({ cursor: 3, projects: [project] })
    await reading
    await settle()
    // The first read, and one more for the change it may have missed; not a third when the gathered changes are read.
    expect(client.listProjects).toHaveBeenCalledTimes(2)

    // A read begun after a change holds it: nothing more.
    emit(changed('project', 'p1', null, 'p1'))
    await settle()
    expect(client.listProjects).toHaveBeenCalledTimes(3)
  })

  it('marks a thread again when it was being read as a change touched it', async () => {
    const { client, cache, emit, read } = opened()
    const first = later<ThreadSnapshot>()
    vi.mocked(client.getThread).mockImplementationOnce(() => first.promise)
    const reading = cache.fetchQuery(read.thread('th1'))
    emit(changed('thread_item', 'i1', 'th1'))
    first.resolve(snapshot())
    await reading
    expect(cache.getQueryState(keys.thread('th1'))?.isInvalidated).toBe(true)
  })

  it('stops watching when told to', () => {
    const { feed, listeners } = opened()
    expect(listeners.size).toBe(1)
    feed.stop()
    expect(listeners.size).toBe(0)
  })
})

describe('the window’s reads', () => {
  const page = (sequences: ReadonlyArray<number>, earlier: boolean) =>
    snapshot({ items: sequences.map((sequence) => ({ ...items.says(`#${sequence}`), id: `i${sequence}`, sequence })), earlier })
  const sequences = (thread: ThreadSnapshot) => thread.items.map((item) => item.sequence)

  it('keeps the earlier pages of a thread read again, as long as the new page meets them', () => {
    const was = page([1, 2, 3], true)
    expect(sequences(continued(was, page([3, 4], false)))).toEqual([1, 2, 3, 4])
    expect(continued(was, page([3, 4], false)).earlier).toBe(true)
    expect(sequences(continued(was, page([4, 5], false)))).toEqual([1, 2, 3, 4, 5])
    // Many came since: it starts over from the new page.
    expect(sequences(continued(was, page([9, 10], true)))).toEqual([9, 10])
    expect(sequences(continued(undefined, page([9], false)))).toEqual([9])
    expect(sequences(continued(was, page([], false)))).toEqual([])
  })

  it('starts over from the new page when an earlier one holds something that may have moved since', () => {
    const at = (item: ThreadSnapshot['items'][number], sequence: number) => ({ ...item, id: `i${sequence}`, sequence })
    const with_ = (first: ThreadSnapshot['items'][number]) => snapshot({ items: [at(first, 1), at(items.says('#2'), 2)], earlier: true })
    // A tool call still running, a message still queued: the earlier page goes, to be read again.
    for (const unsettled of [items.tool({ status: 'in_progress' }), items.you('Wait', { state: 'queued', interrupting: false })])
      expect(sequences(continued(with_(unsettled), page([2, 3], true)))).toEqual([2, 3])
    // Done and delivered: kept.
    for (const done of [items.tool({ status: 'completed' }), items.you('Hi')])
      expect(sequences(continued(with_(done), page([2, 3], false)))).toEqual([1, 2, 3])
    // What the new page holds is its own, settled or not.
    expect(
      sequences(
        continued(with_(items.says('#1')), {
          ...page([2, 3], false),
          items: [at(items.tool({ status: 'in_progress' }), 2), at(items.says('#3'), 3)],
        }),
      ),
    ).toEqual([1, 2, 3])
  })

  it('reads the home from where it was pinned, for each window', async () => {
    const { client, cache, read } = opened()
    await cache.fetchQuery(read.home())
    expect(client.getHome).toHaveBeenLastCalledWith(undefined)
    homeSince(client).since = '2026-10-07T09:00:00.000Z'
    await cache.fetchQuery({ ...read.home(), staleTime: 0 })
    expect(client.getHome).toHaveBeenLastCalledWith('2026-10-07T09:00:00.000Z')
    expect(homeSince(fakeClient().client).since).toBeUndefined()
  })

  it('asks every agent again and keeps what they say; waits for a screen’s reads, failed or not', async () => {
    const { client, cache } = opened()
    await recheckStatus(client, cache)
    expect(client.status).toHaveBeenCalledWith({ recheck: true })
    expect(cache.getQueryData(keys.status)).toEqual(status)
    await expect(readFirst(Promise.resolve(1), Promise.reject(new Error('no')))).resolves.toBeUndefined()
  })
})
