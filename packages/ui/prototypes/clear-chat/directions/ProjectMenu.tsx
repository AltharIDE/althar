// Scrappy: the project's ⋯ in its header: what it is made of, and in A the deliberate end of the conversation.
import { useState } from 'react'

import { ChromeButton } from '../../../src/chrome/ChromeButton/ChromeButton'
import type { ProjectPart } from '../../../src/chrome/ProjectHeader/ProjectHeader'
import { BrandMark } from '../../../src/foundations/Marks/Marks'
import { Menu, MenuGroup, MenuItem, MenuSeparator } from '../../../src/primitives/Menu/Menu'
import type { Direction, Talk } from '../state'
import s from './directions.module.css'
import { ForgetDialog } from './Forget'

export const menuText = {
  trigger: 'More for this project',
  madeOf: 'Made of',
  forget: 'Forget everything…',
}
const t = menuText

export function ProjectMenu({ direction, parts }: { direction: Direction; talk: Talk; parts: ReadonlyArray<ProjectPart> }) {
  const [asking, setAsking] = useState(false)
  const forgetting = direction === 'A'
  return (
    <>
      <Menu label={t.trigger} align="end" width={300} trigger={<ChromeButton icon="more" label={t.trigger} compact />}>
        {forgetting && (
          <MenuItem icon="remove" tone="danger" quiet onSelect={() => setAsking(true)}>
            {t.forget}
          </MenuItem>
        )}
        {forgetting && parts.length > 0 && <MenuSeparator />}
        {parts.length > 0 && (
          <MenuGroup label={t.madeOf}>
            {parts.map((part) => (
              <MenuItem
                key={part.id}
                lead={
                  part.brand === undefined ? <span className={s.noMark} aria-hidden="true" /> : <BrandMark brand={part.brand} size={14} />
                }
                {...(part.openLabel === undefined ? {} : { hint: part.openLabel })}
                disabled={part.onOpen === undefined}
                onSelect={() => part.onOpen?.()}
              >
                {part.name}
              </MenuItem>
            ))}
          </MenuGroup>
        )}
      </Menu>
      {asking && <ForgetDialog onClose={() => setAsking(false)} />}
    </>
  )
}
