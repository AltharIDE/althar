// Scrappy: the parts the directions share: the list of sections, a section on a sheet of its own, and the search field.
import { Fragment } from 'react'

import { Button, Field, type HeadingLevel, Panel } from '../../index'
import type { Models } from './models'
import { SECTIONS, type SectionId, SectionBody, sectionOf } from './sections'

/** The sections, one under another, the one open raised; a little room between the accounts, Althar's own ways, and about it. */
export function SectionNav({
  current,
  onPick,
  label = 'Settings',
}: {
  current: SectionId | null
  onPick: (id: SectionId) => void
  label?: string
}) {
  return (
    <nav aria-label={label} style={{ display: 'grid', gap: 2 }}>
      {SECTIONS.map((section, i) => (
        <Fragment key={section.id}>
          {i > 0 && SECTIONS[i - 1]?.group !== section.group && <span style={{ height: 10 }} />}
          <Button
            variant={section.id === current ? 'default' : 'quiet'}
            icon={section.icon}
            onClick={() => onPick(section.id)}
            aria-current={section.id === current ? 'page' : undefined}
            style={{ width: '100%', justifyContent: 'flex-start' }}
          >
            {section.title}
          </Button>
        </Fragment>
      ))}
    </nav>
  )
}

/** One section on a sheet of its own: its name, a line on what it is for, then its settings. */
export function SectionPanel({
  id,
  m,
  wide = true,
  headingLevel = 2,
}: {
  id: SectionId
  m: Models
  wide?: boolean
  headingLevel?: HeadingLevel
}) {
  const section = sectionOf(id)
  return (
    <Panel title={section.title} lede={section.lede} headingLevel={headingLevel} id={`section-${id}`}>
      <div style={{ padding: '0 22px 16px' }}>
        <SectionBody id={id} m={m} wide={wide} />
      </div>
    </Panel>
  )
}

export function SearchField({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  return (
    <Field
      type="search"
      aria-label="Search settings"
      placeholder="Search settings"
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      style={{ width: '100%' }}
    />
  )
}
