import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_PREFERENCES, type AppPreferences } from '../src/main/appPreferences'
import type { DesktopChrome, Rgb } from '../src/main/desktop'
import { applyAccent, hexToRgb } from '../src/renderer/shared/accent'
import { SystemAccent } from '../src/renderer/shared/SystemAccent'
import { usePreferences } from '../src/renderer/shared/usePreferences'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'

function Appearance() {
  const { set } = usePreferences()
  return (
    <>
      <SystemAccent />
      <button type="button" onClick={() => set('accent', 'althar')}>
        Use Althar’s accent
      </button>
    </>
  )
}

const chrome = (accent: Rgb | null): DesktopChrome => ({
  kind: 'drawn',
  family: 'gnome',
  look: 'gnome',
  layout: { start: [], end: ['close'] },
  accent,
})
const sheet = () => document.getElementById('althar-system-accent')

describe('the system accent on the window', () => {
  it('updates with the desktop, falls back for an illegible colour, and removes its sheet when the preference changes', async () => {
    const listeners = new Set<(chrome: DesktopChrome) => void>()
    const host = fakeHost({
      preferences: vi.fn(async (): Promise<AppPreferences> => ({ ...DEFAULT_PREFERENCES, accent: 'system' })),
      chrome: () => chrome(hexToRgb('#3584e4')),
      onChrome: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    })
    const view = withServices(<Appearance />, fakeClient().client, host)
    await waitFor(() => expect(sheet()?.textContent).toContain('--signal:'))
    const blue = sheet()?.textContent
    act(() => listeners.forEach((listener) => listener(chrome(hexToRgb('#3a944a')))))
    expect(sheet()?.textContent).not.toBe(blue)
    act(() => listeners.forEach((listener) => listener(chrome(hexToRgb('#f5c211')))))
    expect(sheet()).toBeNull()
    act(() => listeners.forEach((listener) => listener(chrome(null))))
    expect(sheet()).toBeNull()
    act(() => listeners.forEach((listener) => listener(chrome(hexToRgb('#3584e4')))))
    await waitFor(() => expect(sheet()).not.toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Use Althar’s accent' }))
    await waitFor(() => expect(sheet()).toBeNull())
    view.unmount()
    expect(listeners.size).toBe(0)
  })

  it('draws no override where the desktop says nothing, and cleans up a mounted override on close', async () => {
    const absent = withServices(<SystemAccent />, fakeClient().client, fakeHost())
    expect(sheet()).toBeNull()
    absent.unmount()
    const host = fakeHost({
      preferences: vi.fn(async (): Promise<AppPreferences> => ({ ...DEFAULT_PREFERENCES, accent: 'system' })),
      chrome: () => chrome(hexToRgb('#3584e4')),
    })
    const view = withServices(<SystemAccent />, fakeClient().client, host)
    await waitFor(() => expect(sheet()).not.toBeNull())
    view.unmount()
    expect(sheet()).toBeNull()
  })

  it('keeps one style element when the same override is applied twice and updates it in place', () => {
    const doc = document.implementation.createHTMLDocument('Accent')
    applyAccent(':root { --signal: blue }', doc)
    const first = doc.head.querySelector('style')
    applyAccent(':root { --signal: blue }', doc)
    expect(doc.head.querySelectorAll('style')).toHaveLength(1)
    expect(doc.head.querySelector('style')).toBe(first)
    applyAccent(':root { --signal: green }', doc)
    expect(first?.textContent).toContain('green')
    applyAccent(null, doc)
    applyAccent(null, doc)
    expect(doc.head.querySelector('style')).toBeNull()
  })
})
