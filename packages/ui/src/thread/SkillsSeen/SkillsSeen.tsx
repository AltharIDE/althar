import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import s from './SkillsSeen.module.css'

export interface SeenSkillRow {
  readonly name: string
  /** Its `SKILL.md`, on hover. */
  readonly path: string
  readonly from: 'person' | 'repository'
}

export interface SkillsSeenText {
  person: string
  repository: string
}

export const skillsSeenText: SkillsSeenText = { person: 'Yours', repository: 'This repository' }

export interface SkillsSeenProps extends Disclosable {
  /** Who could see how many: "Codex could see 3 skills". */
  title: string
  skills: ReadonlyArray<SeenSkillRow>
  className?: string
  text?: Partial<SkillsSeenText>
}

/**
 * What a lead's agent could see of the person's skills and the repository's,
 * in one faint line of a task's thread. Opened, their names, by whose they are.
 */
export function SkillsSeen({ title, skills, className, text, ...disclosure }: SkillsSeenProps) {
  const t = { ...skillsSeenText, ...text }
  const groups = [
    { label: t.person, skills: skills.filter((skill) => skill.from === 'person') },
    { label: t.repository, skills: skills.filter((skill) => skill.from === 'repository') },
  ].filter((group) => group.skills.length > 0)
  const line = (
    <>
      <span className={s.mark}>{skills.length > 0 && <Icon name="chevron" size={11} className={s.chevron} />}</span>
      <span className={s.title}>{title}</span>
    </>
  )
  if (skills.length === 0) return <p className={cx(s.seen, s.row, className)}>{line}</p>
  return (
    <Disclosure {...disclosure} className={cx(s.seen, className)}>
      <DisclosureTrigger>
        <button type="button" className={s.row}>
          {line}
        </button>
      </DisclosureTrigger>
      <Fold>
        <div className={s.groups}>
          {groups.map((group) => (
            <div key={group.label} className={s.group}>
              <h4 className={s.label}>{group.label}</h4>
              <ul className={s.names}>
                {group.skills.map((skill) => (
                  <li key={skill.path} className={s.name} title={skill.path}>
                    {skill.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Fold>
    </Disclosure>
  )
}
