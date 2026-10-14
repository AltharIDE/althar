// Scrappy, B: no panel. Settings is a page of the window, as a project's rules are: sections down the side, a search over them all.
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { BackCrumb, IconButton, Panel } from '../../index'
import { SearchField, SectionNav, SectionPanel } from './frame'
import { type Models, useModels } from './models'
import type { ProtoSettingsProps } from './seams/SettingsPanel'
import { Found, PROJECTS, QuickToggles, type SectionId } from './sections'

import { text } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'

export function DirectionB({ start, open, onOpenChange, glance, where }: ProtoSettingsProps) {
  const m = useModels(start, open, glance)
  return (
    <>
      <IconButton icon="gear" label={text.title} kbd={text.kbd} size="small" onClick={() => onOpenChange(!open)} />
      {open && <SettingsPage m={m} back={where} onClose={() => onOpenChange(false)} />}
    </>
  )
}

/** Where the window's screen is, under its bar: the page goes over it, as a page of its own would. */
function OverScreen({ children }: { children: ReactNode }) {
  const [top, setTop] = useState<number | null>(null)
  useLayoutEffect(() => {
    const screen = document.querySelector('[class*="Tabs-module__screen"]')
    setTop(screen === null ? 44 : screen.getBoundingClientRect().top)
  }, [])
  if (top === null) return null
  return createPortal(
    <div className="ch-root" style={{ position: 'fixed', inset: `${top}px 0 0 0`, zIndex: 5, background: 'var(--n-2)', overflowY: 'auto' }}>
      {children}
    </div>,
    document.body,
  )
}

/**
 * Settings as a page: the way back to the screen it opened over, at the top;
 * then the sections down the side under a search (and, where nothing else
 * holds them, the two switches), and the one open beside them.
 */
export function SettingsPage({
  m,
  onClose,
  first = 'agents',
  back = 'Home',
  quick = true,
}: {
  m: Models
  onClose: () => void
  first?: SectionId
  /** The screen it opened over, which Escape goes back to. */
  back?: string | undefined
  /** The two switches at the top of the side, where no panel holds them. */
  quick?: boolean
}) {
  const [at, setAt] = useState<SectionId>(first)
  const [query, setQuery] = useState('')
  // Escape goes back, unless something on the page has it first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (query !== '') return setQuery('')
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, query])
  const pick = (id: SectionId) => {
    setQuery('')
    setAt(id)
  }
  return (
    <OverScreen>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '14px 48px 72px' }}>
        <div style={{ display: 'flex', margin: '0 0 16px' }}>
          <BackCrumb to={back} kbd="esc" onBack={onClose} title="Settings" titleLevel={1} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
          <aside style={{ position: 'sticky', top: 14, display: 'grid', gap: 14 }}>
            <SearchField value={query} onChange={setQuery} />
            {quick && <QuickToggles m={m} stacked onOpen={pick} />}
            <SectionNav current={query === '' ? at : null} onPick={pick} />
          </aside>
          <main>
            {query.trim() === '' ? (
              <SectionPanel key={at} id={at} m={m} />
            ) : (
              <Panel title={`Settings for “${query.trim()}”`} lede="Change one here, or open the section it is in.">
                <div style={{ padding: '0 22px 18px' }}>
                  <Found query={query} m={m} onOpen={pick} projects={PROJECTS} />
                </div>
              </Panel>
            )}
          </main>
        </div>
      </div>
    </OverScreen>
  )
}
