// Scrappy: B, tabs on top: the project's name, its sections as tabs across under it, and the open one as wide as the page.
import { ProjectMark, Segmented } from '../../../src/index'
import type { Things } from '../parts'
import { Body, QuickCards, sectionText } from '../sections'
import { proto, SECTIONS, type Section, useProto } from '../state'
import c from './pages.module.css'

export function B({ things }: { things: Things }) {
  const section = useProto().section ?? 'general'
  const go = (next: Section) => proto.set({ section: next })
  return (
    <div className={c.page}>
      <div className={c.wide}>
        <header className={c.top}>
          <ProjectMark seed={things.seed} ink={things.ink} size={44} />
          <div className={c.grow}>
            <h1 className={c.name}>{things.name}</h1>
            <p className={c.lede}>Settings for its tasks, its code and its agents</p>
          </div>
          <div style={{ width: 420 }}>
            <QuickCards things={things} onSection={go} />
          </div>
        </header>
        <div className={c.tabs}>
          <Segmented<Section>
            label="Section"
            value={section}
            onChange={go}
            options={SECTIONS.map((id) => ({
              value: id,
              label: sectionText[id].title,
              ...(id === 'code' && things.troubles > 0 ? { dot: 'yours' as const, dotLabel: 'needs you' } : {}),
            }))}
          />
        </div>
        <p className={c.tabLede}>{sectionText[section].lede}</p>
        <Body key={section} section={section} things={things} switches={false} />
      </div>
    </div>
  )
}
