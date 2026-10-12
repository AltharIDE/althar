import { type ComponentType, type MouseEvent, useEffect, useState } from 'react'

import { PAGE_META } from '../../content/pages'
import { addDisplay } from '../../home/display'
import { Pathname } from '../../lib/pathname'
import { Nav } from '../../shared/Nav'
import { Crew } from './Crew'
import s from './NavLab.module.css'
import { Printed } from './Printed'
import { Scale } from './Scale'
import { type NavProps, PAGES } from './shared'

/*
 * The nav concepts, side by side: each over a stand-in page, to be seen in
 * place and switched between, with the live nav as it is today to compare.
 * In development only (App.tsx). `/lab/nav?concept=crew&page=/thesis` opens
 * on one; choosing a page in a concept's nav moves the nav here instead of
 * leaving, so it can be seen moving.
 */

addDisplay()

interface Concept {
  id: string
  name: string
  /** The idea, and what of the brand pack it is built from. */
  idea: string
  Nav: ComponentType<NavProps>
}

/** Today's nav, reading the page from the lab rather than the address. */
function Today({ here }: NavProps) {
  return (
    <Pathname value={here}>
      <Nav />
    </Pathname>
  )
}

const CONCEPTS: readonly Concept[] = [
  {
    id: 'scale',
    name: 'Scale',
    idea: 'The mark is a section through a scale ruler, so the bar is the ruler’s edge: the pages are numbered like a set’s sheets along a track of ticks, and the mark stands on the track under the page you’re on, sliding to whichever you point at. Built from the mark (Logo, its cobalt point), the Masthead’s numbered parts in JetBrains Mono, and paper and ink.',
    Nav: Scale,
  },
  {
    id: 'printed',
    name: 'Printed',
    idea: 'The README banner’s masthead as the bar: two inks on paper stock, the halftone mark coming up dot by dot, the pages in the banner’s spaced mono capitals, and the page you’re on printed over with a screen of cobalt dots; on a phone, the banner’s big words with the current one as a halftone. Built from HalftoneMark and the palette’s print-stock, print-black and cobalt.',
    Nav: Printed,
  },
  {
    id: 'crew',
    name: 'Crew',
    idea: 'Today’s island, with a crew member for each page: the project for Home, the coordinator for Shifts, the lead for the Thesis, a task for Docs and the reviewer for GitHub. The current page’s figure hangs under its name, blinking, others drop when pointed at, and all go up behind the island as you read. Built from the crew figures (brand/export/crew, light and dark) and the island.',
    Nav: Crew,
  },
  { id: 'today', name: 'Today', idea: 'The live nav as it is, to compare. Its links leave the lab.', Nav: Today },
]

const STAND_IN: Record<string, { kicker: string; title: string }> = {
  '/': { kicker: 'Althar', title: 'Every coding agent you pay for, in one app.' },
  '/shifts': { kicker: 'Shifts', title: 'What changed for people who code with agents.' },
  '/thesis': { kicker: 'The thesis', title: 'The Fourth Age of Software Engineering.' },
  '/docs': { kicker: 'Docs', title: 'Althar’s documentation is being written.' },
}

const param = (name: string) => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name))

export function NavLab() {
  const [concept, setConcept] = useState(() => CONCEPTS.find((c) => c.id === param('concept')) ?? CONCEPTS[0]!)
  const [here, setHere] = useState(() => PAGES.find((p) => p.href === param('page'))?.href ?? '/')

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('concept', concept.id)
    url.searchParams.set('page', here)
    window.history.replaceState(null, '', url)
  }, [concept, here])

  const go = (href: string, e: MouseEvent) => {
    e.preventDefault()
    setHere(href)
    window.scrollTo({ top: 0 })
  }
  const page = STAND_IN[here] ?? STAND_IN['/']!
  const meta = PAGE_META[here as keyof typeof PAGE_META]
  const { Nav: Concept } = concept

  return (
    <>
      <Concept key={concept.id} here={here} onGo={go} />
      <main id="main" className={s.page}>
        <p className={s.kicker}>{page.kicker}</p>
        <h1 className={s.title}>{page.title}</h1>
        <p className={s.lede}>{meta?.description}</p>
        <div className={s.blocks} aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={s.block} />
          ))}
        </div>
      </main>
      <aside className={s.panel} aria-label="Nav concepts">
        <div className={s.choices} role="group" aria-label="Concept">
          {CONCEPTS.map((c) => (
            <button key={c.id} type="button" aria-pressed={c.id === concept.id} onClick={() => setConcept(c)}>
              {c.name}
            </button>
          ))}
        </div>
        <p className={s.idea}>{concept.idea}</p>
      </aside>
    </>
  )
}
