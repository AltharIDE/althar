// Scrappy: a repository's recorded setup as plain text, from the kit's own parts, in project settings' Running.
import { useId, useState } from 'react'

import { FieldArea, SettingGroup } from '@althar/ui'

import s from './proto.module.css'
import { proto, type Repo, useProto } from './state'

const text = {
  title: 'Before each task starts',
  commands: 'Commands, one a line',
  copy: 'Files to copy from your checkout',
  unrecorded: 'The first task’s lead fills this in.',
}

const linesOf = (words: string) =>
  words
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

/** A box of lines, kept when the person leaves it. */
function Lines({
  id,
  lines,
  placeholder,
  onSave,
}: {
  id: string
  lines: ReadonlyArray<string> | null
  placeholder?: string
  onSave: (lines: ReadonlyArray<string>) => void
}) {
  const [value, setValue] = useState((lines ?? []).join('\n'))
  return (
    <FieldArea
      id={id}
      className={s.mono}
      wrap="off"
      rows={Math.max(2, value.split('\n').length)}
      value={value}
      spellCheck={false}
      {...(placeholder === undefined ? {} : { placeholder })}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onSave(linesOf(value))}
    />
  )
}

function RepoSetup({ repo, many }: { repo: Repo; many: boolean }) {
  const commandsId = useId()
  const copyId = useId()
  const unrecorded = repo.commands === null
  return (
    <section className={s.repo} aria-label={repo.name}>
      {many && <h4 className={s.name}>{repo.name}</h4>}
      <label className={s.label} htmlFor={commandsId}>
        {text.commands}
      </label>
      <Lines
        id={commandsId}
        lines={repo.commands}
        {...(unrecorded ? { placeholder: text.unrecorded } : {})}
        onSave={(commands) => proto.change(repo.id, { commands })}
      />
      <label className={s.label} htmlFor={copyId}>
        {text.copy}
      </label>
      <Lines id={copyId} lines={repo.copy} onSave={(copy) => proto.change(repo.id, { copy })} />
    </section>
  )
}

/** In Running, after what the project runs. */
export function ProtoFolders() {
  const p = useProto()
  return (
    <SettingGroup title={text.title} headingLevel={3}>
      <div className={s.repos}>
        {p.repos.map((repo) => (
          <RepoSetup key={`${p.which}:${p.moment}:${repo.id}`} repo={repo} many={p.repos.length > 1} />
        ))}
      </div>
    </SettingGroup>
  )
}
