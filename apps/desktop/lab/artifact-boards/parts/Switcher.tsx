import { useState } from 'react'

import { Icon, Popover, Segmented } from '@althar/ui'

import { agoWords, ARTIFACTS, type Artifact, type ArtifactKind, boardCount, KIND_WORDS } from '../artifacts'
import { live } from '../live'
import { Glyph } from './Glyph'
import { Where } from './Keep'
import { Thumb } from './Thumb'
import s from './switcher.module.css'

/*
 * The artifact's name in the head of the panel beside a conversation, which
 * opens every artifact on the project: this task's first, then the rest,
 * newest first, each with a picture of its first board. Picking one shows
 * it in the same place, beside the same conversation.
 */

export function Switcher({
  artifact,
  task,
  onPick,
  open,
  onOpenChange,
}: {
  artifact: Artifact
  /** The task whose conversation it is beside: its artifacts come first. */
  task: string | null
  onPick: (id: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [kind, setKind] = useState<ArtifactKind | 'all'>('all')
  const shown = ARTIFACTS.filter((one) => kind === 'all' || one.kind === kind)
  const here = shown.filter((one) => one.task === task)
  const rest = shown.filter((one) => one.task !== task)
  const row = (one: Artifact) => (
    <li key={one.id}>
      <button
        type="button"
        className={s.row}
        aria-current={one.id === artifact.id || undefined}
        onClick={() => {
          onPick(one.id)
          onOpenChange(false)
        }}
      >
        <Thumb artifact={one} className={s.thumb} />
        <span className={s.words}>
          <span className={s.title}>{one.title}</span>
          <span className={s.facts}>
            {KIND_WORDS[one.kind]}
            {one.kind === 'design' ? ` · ${boardCount(one)} boards` : ''} · v{live.version(one)} · {agoWords(one.ago)}
          </span>
          <span className={s.by}>
            {one.found ? `${one.by}, by hand` : one.by}
            <Where artifact={one} />
          </span>
        </span>
        {one.comments > 0 && (
          <span className={s.comments} title={`${one.comments} open comments`}>
            <Icon name="comment" size={11} />
            {one.comments}
          </span>
        )}
      </button>
    </li>
  )
  return (
    <Popover
      label="Artifacts on kiln"
      width={440}
      align="start"
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <button type="button" className={s.trigger}>
          <span className={s.tile} aria-hidden>
            <Icon name="canvas" size={14} />
          </span>
          <span className={s.triggerTitle}>{artifact.title}</span>
          <Glyph name="down" size={11} />
        </button>
      }
    >
      <div className={s.menu}>
        <Segmented
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'design', label: 'Designs' },
            { value: 'diagram', label: 'Diagrams' },
            { value: 'document', label: 'Documents' },
            { value: 'chart', label: 'Charts' },
          ]}
        />
        <div className={s.list}>
          {here.length > 0 && (
            <>
              <div className={s.group}>From {task}</div>
              <ul>{here.map(row)}</ul>
            </>
          )}
          {rest.length > 0 && (
            <>
              <div className={s.group}>Elsewhere on kiln</div>
              <ul>{rest.map(row)}</ul>
            </>
          )}
        </div>
      </div>
    </Popover>
  )
}
