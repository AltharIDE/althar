import { useState } from 'react'

import { keys, LinkButton, modKey } from '@althar/ui'
import { NewProject } from '@althar/ui/screens'

import { useServices } from '../../data/services'
import { device, platform } from '../../shared/device'
import type { ConnectionsModel } from '../connections/useConnections'
import type { DraftError } from './draft'
import s from './NewProject.module.css'
import { SetupSide } from './SetupSide'
import type { NewProjectModel } from './useNewProject'

/*
 * A new project's tab: the kit's NewProject, the project as it takes shape,
 * named on its left, set up on its right: where its code comes from, where
 * it lives and where its issues go, a host or tracker connected in place
 * where it's asked for. Made, the tab becomes the project's own; closed, or
 * left with Escape, nothing is made.
 */

export const text = {
  /** The kit's words, with this computer's name and keys. */
  page: () => ({
    found: `On ${device.this}`,
    foundLike: (name: string) => `On ${device.this}, named like ${name}`,
    more: (count: number) => `${count} more on ${device.this}`,
    createKbd: modKey(keys.enter),
    needsFolder: 'Choose where its code comes from first.',
  }),
  access: 'Open Privacy & Security',
  chooseAnother: 'Choose another folder',
  open: (name: string) => `Open ${name}`,
  signIn: 'Sign in',
}

/** What stopped it, in words, with what puts it right where something does. */
function ErrorLine({
  error,
  onAccess,
  onChoose,
  onOpen,
}: {
  error: DraftError
  onAccess: () => void
  onChoose: () => void
  onOpen: (projectId: string) => void
}) {
  const fix = error.fix
  return (
    <>
      {error.said}{' '}
      {fix?.kind === 'access' &&
        (platform === 'darwin' ? (
          <LinkButton onClick={onAccess}>{text.access}</LinkButton>
        ) : (
          <LinkButton onClick={onChoose}>{text.chooseAnother}</LinkButton>
        ))}
      {fix?.kind === 'open' && <LinkButton onClick={() => onOpen(fix.projectId)}>{text.open(fix.name)}</LinkButton>}
      {fix?.kind === 'sso' && fix.url !== null && (
        <a className={s.link} href={fix.url} target="_blank" rel="noreferrer">
          {text.signIn}
        </a>
      )}
    </>
  )
}

export function NewProjectView({
  model,
  onCreated,
  onOpen,
  onClose,
}: {
  model: NewProjectModel
  /** Kept for the page's callers; connecting is in place, in the setup. */
  connections?: ConnectionsModel
  /** It was made: its tab opens on it. */
  onCreated: (projectId: string) => void
  /** Another project, as one of its folders is already: its tab opens on it, and this one stays. */
  onOpen: (projectId: string) => void
  /** Escape: nothing is made, and the tab closes. */
  onClose: () => void
}) {
  const { host } = useServices()
  const [dropping, setDropping] = useState(false)
  const { draft, setup } = model
  if (draft === null || setup === null) return null
  const chooseFolder = () => void model.choose()
  return (
    <div
      className={s.window}
      onDragEnter={() => setDropping(true)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={() => setDropping(false)}
    >
      <NewProject
        seed={draft.id}
        name={draft.name}
        onNameChange={model.rename}
        ink={model.ink}
        onInkChange={model.colour}
        taken={model.taken}
        folders={model.folders}
        onRemove={model.leaveOut}
        onChoose={() => {
          setup.onWay('folder')
          chooseFolder()
        }}
        onDrop={(files) => {
          setup.onWay('folder')
          void model.drop(files)
        }}
        found={null}
        onAdd={(id) => void model.add(id)}
        findings={model.findings}
        side={
          <SetupSide
            setup={setup}
            draft={draft}
            creating={draft.creating}
            onChoose={chooseFolder}
            onLeaveOut={model.leaveOut}
            onStartFresh={() => void model.startFresh()}
            onChooseCloneInto={() => void model.chooseCloneInto()}
            onOpenProject={onOpen}
            dropping={dropping}
          />
        }
        {...(setup.footNote === null ? {} : { footNote: setup.footNote })}
        // oxlint-disable-next-line althar/press-at-once -- A form the runtime and a code host check (a clone, a repository made there): it stays, each part ticking as it is done, until made, so a refusal lands in it.
        onCreate={() =>
          void model.create().then((made) => {
            if (made !== null) onCreated(made.id)
          })
        }
        onCancel={onClose}
        creating={draft.creating}
        {...(draft.error === null
          ? {}
          : {
              error: (
                <ErrorLine error={draft.error} onAccess={() => void host.openFolderAccess()} onChoose={chooseFolder} onOpen={onOpen} />
              ),
            })}
        text={text.page()}
      />
    </div>
  )
}
