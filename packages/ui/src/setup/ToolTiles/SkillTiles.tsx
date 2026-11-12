import { type ReactNode, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { ListMotion } from '../../lib/ListMotion'
import type { HeadingLevel } from '../../primitives/Heading/Heading'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { ControlToggle } from '../ControlCenter/ControlCenter'
import {
  AddTile,
  projectName,
  reachOf,
  TileGrid,
  TileLine,
  TilesFailed,
  TilesLoading,
  ToolGroup,
  ToolsEmpty,
  ToolTile,
  toolWordsText,
  type ToolWordsText,
  useBackFocus,
} from './ToolParts'
import { type SkillTileModel, TOOL_ROLES, type ToolAgentView, type ToolProjectView, type ToolRoleId, type ToolSyncModel } from './tools'
import s from './ToolTiles.module.css'

/*
 * Settings › Skills, as tiles: Althar ships none of its own, so what is here
 * is the person's (their agents' skill folders and plugins, and what they
 * added from GitHub) and a repository's own (`.claude/skills`). A tile per
 * skill, as servers: the round switch gives it to every role or none, the
 * name opens it in place. Under it, who gets it and where, or Update ready
 * (violet) for one added from GitHub that has a newer version; those sort
 * first. Add from GitHub is the dashed tile, and Same skills everywhere sits
 * beside it: it only links each skill into the agents' folders, so it turns
 * on at once, and asks on the way off whether its links stay.
 */

export interface SkillTilesText extends ToolWordsText {
  updateReady: string
  add: string
  noneTitle: string
  noneLine: string
  same: string
  offTitle: string
  offWhat: (n: number) => string
  takeBack: string
  keepThem: string
  cancel: string
}

export const skillTilesText: SkillTilesText = {
  ...toolWordsText,
  updateReady: 'Update ready',
  add: 'Add from GitHub',
  noneTitle: 'No skills yet',
  noneLine: 'Add one from GitHub, or put a folder with a SKILL.md in any of your agents’ skill folders.',
  same: 'Same skills everywhere',
  offTitle: 'Stop linking them everywhere?',
  offWhat: (n) =>
    n === 0
      ? 'It linked nothing.'
      : `It linked ${n} ${n === 1 ? 'skill' : 'skills'} into your agents’ folders. The links can stay, or come out.`,
  takeBack: 'Take them out',
  keepThem: 'Leave them',
  cancel: 'Cancel',
}

export interface SkillTilesProps {
  skills: readonly SkillTileModel[]
  /** The person's agents, with where each keeps its skills. */
  agents: readonly ToolAgentView[]
  projects: readonly ToolProjectView[]
  /** Same skills everywhere: its targets' `adds` are the links it made, while on. */
  sync: ToolSyncModel
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  open?: string | null
  defaultOpen?: string | null
  onOpenChange?: (id: string | null) => void
  /** An opened skill, in place of the tiles: a SkillSheet, given its way back. Without it, a name opens nothing. */
  sheet?: (skill: SkillTileModel, back: () => void) => ReactNode
  onRoles: (skill: SkillTileModel, roles: readonly ToolRoleId[]) => void
  /** Add from GitHub: the consumer opens an AddSkillDialog. Without it, nothing offers to add. */
  onAdd?: () => void
  onSync: (on: boolean, takeBack: boolean) => void
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<SkillTilesText>
}

/** Settings › Skills: the person's skills as tiles, a repository's own, and the switch that links them into every agent. */
export function SkillTiles({
  skills,
  agents,
  projects,
  sync,
  loading = false,
  error = null,
  onRetry,
  open,
  defaultOpen = null,
  onOpenChange,
  sheet,
  onRoles,
  onAdd,
  onSync,
  headingLevel = 3,
  className,
  text,
}: SkillTilesProps) {
  const t = { ...skillTilesText, ...text }
  const root = useRef<HTMLDivElement>(null)
  const [openId, setOpen] = useControlled(open, defaultOpen, onOpenChange)
  const [asking, setAsking] = useState(false)
  const opened = sheet === undefined ? undefined : skills.find((one) => one.id === openId)
  useBackFocus(root, opened?.id ?? null)

  const tile = (skill: SkillTileModel) => (
    <ToolTile
      key={skill.id}
      tileKey={skill.id}
      name={skill.name}
      line={skill.update ? <TileLine tone="yours">{t.updateReady}</TileLine> : reachOf(skill, projects, t)}
      on={skill.roles.length > 0}
      onChange={(on) => onRoles(skill, on ? TOOL_ROLES : [])}
      onOpen={sheet === undefined ? undefined : () => setOpen(skill.id)}
    />
  )
  const sorted = (list: readonly SkillTileModel[]) =>
    list
      .map((skill, at) => ({ skill, at }))
      .sort((a, b) => Number(b.skill.update) - Number(a.skill.update) || a.at - b.at)
      .map((one) => one.skill)
  const same = (
    <div className={s.cell}>
      <ControlToggle
        className={s.tile}
        title={t.same}
        line={sync.on ? t.and(agents.map((agent) => agent.name)) : t.off}
        on={sync.on}
        onChange={(on) => (on ? onSync(true, false) : setAsking(true))}
        glyph={<Icon name="copy" size={16} />}
      />
    </div>
  )
  const add = onAdd !== undefined && <AddTile onClick={onAdd}>{t.add}</AddTile>
  const linked = sync.targets.reduce((sum, target) => sum + target.adds.length, 0)
  const errors = sync.errors ?? []

  let body: ReactNode
  if (opened !== undefined && sheet !== undefined) body = sheet(opened, () => setOpen(null))
  else if (loading) body = <TilesLoading label={t.loading} />
  else if (error !== null) body = <TilesFailed error={error} retry={t.retry} onRetry={onRetry} />
  else {
    const yours = sorted(skills.filter((one) => one.repository === null))
    const repositories = [...new Set(skills.flatMap((one) => (one.repository === null ? [] : [one.repository])))]
    body = (
      <ListMotion within={root}>
        {yours.length === 0 ? (
          <ToolsEmpty
            icon="knowledge"
            title={t.noneTitle}
            line={t.noneLine}
            places={agents.map((agent) => ({ id: agent.id, name: agent.name, brand: agent.brand, path: agent.folder }))}
            headingLevel={headingLevel}
          >
            <TileGrid>
              {add}
              {same}
            </TileGrid>
          </ToolsEmpty>
        ) : (
          <TileGrid>
            {yours.map(tile)}
            {add}
            {same}
          </TileGrid>
        )}
        {errors.length > 0 && (
          <p className={s.errors} role="alert">
            {errors.join(' ')}
          </p>
        )}
        {repositories.map((project) => (
          <ToolGroup
            key={project}
            title={t.inRepository(projectName(projects, project))}
            note={<code className={s.code}>.claude/skills</code>}
            headingLevel={headingLevel}
          >
            <TileGrid>{sorted(skills.filter((one) => one.repository === project)).map(tile)}</TileGrid>
          </ToolGroup>
        ))}
      </ListMotion>
    )
  }
  return (
    <div ref={root} className={cx(s.section, className)}>
      {body}
      {asking && (
        <Dialog
          title={t.offTitle}
          description={t.offWhat(linked)}
          onClose={() => setAsking(false)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setAsking(false)}>
                {t.cancel}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setAsking(false)
                  onSync(false, true)
                }}
              >
                {t.takeBack}
              </Button>
              <Button
                onClick={() => {
                  setAsking(false)
                  onSync(false, false)
                }}
              >
                {t.keepThem}
              </Button>
            </>
          }
        />
      )}
    </div>
  )
}
