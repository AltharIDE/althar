import { afterEach, describe, expect, it } from 'vitest'

import { changeSession, dictationsKept, forgetSessions, handlesOf, letGoIfIdle, sessionOf } from '../src/renderer/shared/dictation/sessions'

/*
 * Each thread's dictation is kept while it holds something: what is said,
 * kept or carried, or a composer of the thread showing. Back to nothing, it
 * is forgotten, so a window open for days keeps none for each thread.
 */

describe('dictation kept by thread', () => {
  afterEach(() => forgetSessions())

  it('forgets a thread’s dictation once it is back to nothing, with no composer of its own showing', () => {
    changeSession('th1', { phase: 'listening', away: 1 })
    expect(dictationsKept()).toBe(1)
    changeSession('th1', { phase: 'idle', away: null })
    expect(dictationsKept()).toBe(0)
    expect(sessionOf('th1').phase).toBe('idle')
  })

  it('keeps one whose composer shows, or that kept what couldn’t be written, until neither is so', () => {
    const held = handlesOf('th1')
    held.shown = 1
    changeSession('th1', { phase: 'listening' })
    changeSession('th1', { phase: 'idle' })
    expect(dictationsKept()).toBe(1)
    held.shown = 0
    letGoIfIdle('th1')
    expect(dictationsKept()).toBe(0)
    changeSession('th2', { failed: { seconds: 1, samples: new Float32Array(1), sampleRate: 16_000 } })
    letGoIfIdle('th2')
    expect(dictationsKept()).toBe(1)
  })
})
