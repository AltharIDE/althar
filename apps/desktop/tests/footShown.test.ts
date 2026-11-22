import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('whether the status line shows', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('shows by default, hides at once, and keeps the choice for the next launch', async () => {
    const first = await import('../src/renderer/features/foot/shown')
    expect(first.footShown()).toBe(true)
    first.setFootShown(false)
    expect(first.footShown()).toBe(false)
    vi.resetModules()
    const relaunched = await import('../src/renderer/features/foot/shown')
    expect(relaunched.footShown()).toBe(false)
    relaunched.setFootShown(true)
    vi.resetModules()
    expect((await import('../src/renderer/features/foot/shown')).footShown()).toBe(true)
  })
})
