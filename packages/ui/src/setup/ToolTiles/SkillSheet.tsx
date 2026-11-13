import { useState } from 'react'

import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { HeadingLevel } from '../../primitives/Heading/Heading'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Problem } from '../../primitives/Problem/Problem'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { ControlDetail } from '../ControlCenter/ControlCenter'
import { escapeBack, ProjectPicks, RoleSwitches, SheetFact, toolWordsText, type ToolWordsText } from './ToolParts'
import type { SkillTileModel, ToolAgentView, ToolProjectView, ToolRoleId } from './tools'
import s from './ToolTiles.module.css'

/*
 * A skill, opened in place of the tiles: its SKILL.md as the agent reads it
 * (where it is, its name and description); where it came from on GitHub,
 * with Update where a newer version waits; who gets it; the projects that
 * get it; which of the person's agents have it, faint where one hasn't; and
 * Remove… for one added from GitHub, whose links come out of each agent's
 * folder.
 */

export interface SkillSheetText extends ToolWordsText {
  from: string
  update: string
  agentsLabel: string
  /** For a screen reader, after an agent's name: whether it has the skill. */
  hasIt: string
  hasntIt: string
  remove: string
  removeTitle: (name: string) => string
  removeWhat: string
  removeConfirm: string
  cancel: string
}

export const skillSheetText: SkillSheetText = {
  ...toolWordsText,
  from: 'From',
  update: 'Update',
  agentsLabel: 'Your agents',
  hasIt: 'has it',
  hasntIt: 'hasn’t it',
  remove: 'Remove…',
  removeTitle: (name) => `Remove ${name}?`,
  removeWhat: 'Its links come out of each agent’s folder. Add it from GitHub again to bring it back.',
  removeConfirm: 'Remove',
  cancel: 'Cancel',
}

export interface SkillSheetProps {
  skill: SkillTileModel
  agents: readonly ToolAgentView[]
  projects: readonly ToolProjectView[]
  onBack: () => void
  onRoles: (roles: readonly ToolRoleId[]) => void
  onProject?: (project: string, on: boolean) => void
  /** Reviews the newer version, where there is one. */
  onUpdate?: () => void
  updating?: boolean
  /** For one added from GitHub: its links come out of each agent's folder. */
  onRemove?: () => void
  removing?: boolean
  removeError?: string | null
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<SkillSheetText>
}

/** A skill opened out: its SKILL.md, where it came from, who gets it, which projects and agents have it. */
export function SkillSheet({
  skill,
  agents,
  projects,
  onBack,
  onRoles,
  onProject,
  onUpdate,
  updating = false,
  onRemove,
  removing = false,
  removeError = null,
  headingLevel = 3,
  className,
  text,
}: SkillSheetProps) {
  const t = { ...skillSheetText, ...text }
  const [asking, setAsking] = useState(false)
  const path = skill.home === null ? 'SKILL.md' : `${skill.home.replace(/\/$/, '')}/SKILL.md`
  return (
    <div className={cx(s.opened, className)} onKeyDown={escapeBack(onBack)}>
      <ControlDetail title={skill.name} onBack={onBack} headingLevel={headingLevel} text={{ back: t.back }}>
        <div className={s.sheet}>
          <article className={s.skillFile} aria-label={path}>
            <div className={s.fileHead}>
              <span className={s.fileMark} aria-hidden="true">
                <Icon name="file" size={12} />
              </span>
              <Tooltip label={path}>
                <code className={cx(s.filePath, s.truncate)}>{path}</code>
              </Tooltip>
            </div>
            <pre className={s.front}>
              <span className={s.frontRule}>---</span>
              {'\n'}
              <span className={s.frontKey}>name:</span> {skill.name}
              {'\n'}
              <span className={s.frontKey}>description:</span> {skill.about}
              {'\n'}
              <span className={s.frontRule}>---</span>
            </pre>
          </article>
          {skill.from !== null && (
            <SheetFact label={t.from}>
              <span className={s.fromLine}>
                <BrandMark brand={Brand.GitHub} size={13} />
                <code className={cx(s.runs, s.truncate)}>{skill.from}</code>
                {skill.update && onUpdate !== undefined && (
                  <Button size="small" variant="signal" busy={updating} onClick={onUpdate}>
                    {t.update}
                  </Button>
                )}
              </span>
            </SheetFact>
          )}
          <SheetFact label={t.whoGetsLabel}>
            <RoleSwitches name={skill.name} roles={skill.roles} onChange={onRoles} text={t} />
          </SheetFact>
          {skill.repository === null && projects.length > 1 && onProject !== undefined && (
            <SheetFact label={t.projectsLabel}>
              <ProjectPicks name={skill.name} projects={projects} offIn={skill.offIn} onChange={onProject} text={t} />
            </SheetFact>
          )}
          <SheetFact label={t.agentsLabel}>
            <ul className={s.picks}>
              {agents.map((agent) => {
                const here = skill.here[agent.id] ?? 'missing'
                const yes = here === 'in' || here === 'added' || here === 'differs'
                return (
                  <li key={agent.id} className={cx(s.pick, s.agentChip, !yes && s.pickOut)}>
                    <span className={s.pickMark} aria-hidden="true">
                      {agent.brand === undefined ? <Icon name="plug" size={13} /> : <BrandMark brand={agent.brand} size={13} />}
                    </span>
                    <span className={s.truncate}>{agent.name}</span>
                    <VisuallyHidden>, {yes ? t.hasIt : t.hasntIt}</VisuallyHidden>
                  </li>
                )
              })}
            </ul>
          </SheetFact>
          {skill.from !== null && skill.repository === null && onRemove !== undefined && (
            <div className={s.foot}>
              <LinkButton className={s.danger} onClick={() => setAsking(true)}>
                {t.remove}
              </LinkButton>
            </div>
          )}
        </div>
      </ControlDetail>
      {asking && onRemove !== undefined && (
        <Dialog
          title={t.removeTitle(skill.name)}
          description={t.removeWhat}
          holding={removing}
          onClose={() => setAsking(false)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setAsking(false)}>
                {t.cancel}
              </Button>
              <Button variant="danger" busy={removing} onClick={onRemove}>
                {t.removeConfirm}
              </Button>
            </>
          }
        >
          {removeError !== null && <Problem>{removeError}</Problem>}
        </Dialog>
      )}
    </div>
  )
}
