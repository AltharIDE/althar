import { useState } from 'react'

import { CopyButton, Popover, Segmented } from '@althar/ui'

import { Glyph } from './Glyph'
import s from './parts.module.css'

/*
 * Share: a link to the artifact, or to the boards picked; who it opens for
 * (the people on the project, in their Althar, or anyone, as a page on the
 * web where they can comment); and who has it. Nothing is sent until the
 * link is. Where it lives in git is Keep's.
 */

const PEOPLE = [
  { name: 'Ana', role: 'Engineer', ink: 'ochre', can: 'Can comment' },
  { name: 'Sam', role: 'Product', ink: 'teal', can: 'Can comment' },
] as const

export function Share({
  title,
  slug,
  boards = null,
  open,
  onOpenChange,
  tone = 'chip',
}: {
  title: string
  slug: string
  /** Only these boards, where some are picked: how many. */
  boards?: number | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Drawn as the canvas's chips, or as a panel head's button. */
  tone?: 'chip' | 'head'
}) {
  const [who, setWho] = useState<'team' | 'anyone'>('team')
  const link = `https://althar.link/kiln/${slug}${boards !== null ? `?boards=${boards}` : ''}`
  const what = boards === null ? title : boards === 1 ? `1 board of ${title}` : `${boards} boards`
  return (
    <Popover
      label={`Share ${what}`}
      width={360}
      align="end"
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      trigger={
        <button type="button" className={tone === 'chip' ? s.shareChip : s.shareHead}>
          <Glyph name="share" size={13} />
          <span>Share</span>
        </button>
      }
    >
      <div className={s.share}>
        <div className={s.shareTitle}>Share {what}</div>
        <div className={s.shareLink}>
          <span className={s.shareUrl} title={link}>
            {link.replace('https://', '')}
          </span>
          <CopyButton value={link} text={{ copy: 'Copy link' }} />
        </div>
        <Segmented
          label="Who it opens for"
          value={who}
          onChange={setWho}
          options={[
            { value: 'team', label: 'People on kiln' },
            { value: 'anyone', label: 'Anyone with the link' },
          ]}
        />
        <p className={s.shareLine}>
          {who === 'team'
            ? 'It opens in their Althar, beside their own conversation.'
            : 'It opens as a page on the web. They can comment without Althar; their comments come here.'}
        </p>
        <ul className={s.people} aria-label="Who has it">
          {PEOPLE.map((one) => (
            <li key={one.name}>
              <span className={s.face} data-ink={one.ink} aria-hidden>
                {one.name[0]}
              </span>
              <span className={s.personName}>{one.name}</span>
              <span className={s.personRole}>{one.role}</span>
              <span className={s.personCan}>{one.can}</span>
            </li>
          ))}
          <li>
            <input className={s.addPerson} placeholder="Add someone by name or email" aria-label="Add someone" />
          </li>
        </ul>
        <div className={s.shareRow}>
          <span className={s.shareRowWords}>
            <span>Download</span>
          </span>
          <span className={s.downloads}>
            <button type="button">Boards as PNG</button>
            <button type="button">Page as PDF</button>
          </span>
        </div>
      </div>
    </Popover>
  )
}
