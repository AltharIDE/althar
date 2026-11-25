import { afterEach, describe, expect, it } from 'vitest'

/*
 * A page canvas's chip beside a conversation (src/overlay/chip.ts): run in
 * the page's isolated world, it stays on the page whatever the page does to
 * its document, and answers what was pressed.
 */

await import('../src/overlay/chip')
const chip =
  globalThis.__altharChip ??
  (() => {
    throw new Error('No chip.')
  })()
const host = () => document.querySelector<HTMLElement>('althar-chip')

afterEach(() => void chip.show(null))

describe('a page’s chip', () => {
  it('shows over the page, and comes back where the page takes it out or rewrites its document', async () => {
    chip.show({ title: 'Sign-in page', comment: true })
    expect(host()?.hidden).toBe(false)
    host()?.remove()
    await Promise.resolve()
    expect(host()?.isConnected).toBe(true)
    document.documentElement.innerHTML = '<head></head><body><p>Rewritten</p></body>'
    await Promise.resolve()
    expect(host()?.isConnected).toBe(true)
    // Taken away, it stays away.
    chip.show(null)
    expect(host()?.hidden).toBe(true)
  })

  it('answers what was pressed after what it last said, or nothing once quiet', async () => {
    const { seq } = chip.show({ title: 'Sign-in page', comment: false })
    const nothing = chip.next(seq + 1_000)
    expect(await Promise.race([nothing.then(() => 'answered'), Promise.resolve('waiting')])).toBe('waiting')
  })
})
