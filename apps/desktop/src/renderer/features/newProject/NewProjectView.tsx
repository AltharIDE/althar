import { useState } from 'react'

import type { RepositoryAgentSettings } from '@althar/contracts'

import { keys, LinkButton, modKey, OtherTools, RepositoryPick } from '@althar/ui'
import { homeWelcomeText, NewProject, UpdateHome } from '@althar/ui/screens'

import { canCall } from '../../data/client'
import { useServices } from '../../data/services'
import { device, platform } from '../../shared/device'
import { codeHostOf } from '../../shared/remotes'
import { ConnectDialog, type Opening, openingFor } from '../connections/ConnectDialog'
import type { ConnectionsModel } from '../connections/useConnections'
import { words as elsewhereWords } from '../elsewhere/tiles'
import { useElsewhere } from '../elsewhere/useElsewhere'
import { useHomeName, useHomeUpdating } from '../homes/useHomes'
import { factsOf, useFound } from '../../shared/found'
import { messageOf } from '../../data/client'
import { keys as readKeys } from '../../data/reads'
import { TrustStep } from '../repositoryTrust/TrustStep'
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
  /** The kit's words, with the home's name and this computer's keys. */
  page: (home: string = device.this) => ({
    found: `On ${home}`,
    foundLike: (name: string) => `On ${home}, named like ${name}`,
    more: (count: number) => `${count} more on ${home}`,
    createKbd: modKey(keys.enter),
    needsFolder: 'Choose where its code comes from first.',
  }),
  access: 'Open Privacy & Security',
  chooseAnother: 'Choose another folder',
  /** The repositories another computer's home found, to pick from. */
  onHome: (home: string) => ({
    label: `Repositories on ${home}`,
    find: `Find a repository on ${home}`,
    none: `None found where code is usually kept on ${home}.`,
  }),
  lookFailed: (home: string) => `Couldn’t look on ${home} just now.`,
  lookAgain: 'Look again',
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
  connections,
  onCreated,
  onOpen,
  onClose,
}: {
  model: NewProjectModel
  /** What a folder's host, not connected, opens on. */
  connections?: ConnectionsModel
  /** It was made: its tab opens on it. */
  onCreated: (projectId: string) => void
  /** Another project, as one of its folders is already: its tab opens on it, and this one stays. */
  onOpen: (projectId: string) => void
  /** Escape: nothing is made, and the tab closes. */
  onClose: () => void
}) {
  const { host, client, cache } = useServices()
  const home = useHomeName()
  // A home from before windows made projects there is asked to update: nothing on this page would work on it.
  const older = home.remote && !canCall(client, 'FindHomeFolders')
  const updating = useHomeUpdating()
  const found = useFound(!older)
  const [copied, setCopied] = useState(false)
  // When each found was last worked on is said from when the page opened.
  const [now] = useState(() => new Date())
  const [dropping, setDropping] = useState(false)
  const [opening, setOpening] = useState<Opening | null>(null)
  // Made, with repositories whose own agent settings run something not decided on yet: asked before the tab opens on it.
  const [trusting, setTrusting] = useState<{
    readonly projectId: string
    readonly repositories: ReadonlyArray<RepositoryAgentSettings>
    /** Why what they run couldn't be read, where it couldn't. */
    readonly unreadable?: string
  } | null>(null)
  // What a made project's repositories' agent settings run, asked where any isn't decided on; a failed read said, not taken for none.
  const askTrust = async (projectId: string) => {
    let settings: ReadonlyArray<RepositoryAgentSettings>
    try {
      settings = await client.getAgentSettings(projectId)
    } catch (failure) {
      setTrusting({ projectId, repositories: [], unreadable: messageOf(failure) })
      return
    }
    const undecided = settings.filter((repository) => repository.files.some((file) => file.trusted === null))
    if (undecided.length === 0) return onCreated(projectId)
    cache.setQueryData(readKeys.agentSettings(projectId), settings)
    setTrusting({ projectId, repositories: undecided })
  }
  const { draft, setup } = model
  // What other tools left in the folders chosen, read before the project is made and brought in once it is.
  // Not on another computer's home, where other tools' work isn't read.
  const grants = setup?.way === 'folder' && !home.remote ? [...new Set((draft?.folders ?? []).map((folder) => folder.grant))] : []
  const elsewhere = useElsewhere(client, grants.length === 0 ? null : { grants })
  if (older)
    return (
      <div className={s.window}>
        <main className={s.older}>
          <p className={s.olderLine}>{homeWelcomeText.older(home.name)}</p>
          <UpdateHome
            name={home.name}
            update={updating.offer}
            onUpdate={updating.onUpdate}
            onCheckAgain={updating.onCheckAgain}
            copied={copied}
            onCopy={() => {
              setCopied(true)
              void navigator.clipboard.writeText(updating.offer.command).catch(() => setCopied(false))
            }}
          />
        </main>
      </div>
    )
  if (trusting !== null)
    return (
      <div className={s.window}>
        <TrustStep
          key={trusting.unreadable === undefined ? 'read' : 'unreadable'}
          projectId={trusting.projectId}
          project={draft?.name ?? ''}
          repositories={trusting.repositories}
          {...(trusting.unreadable === undefined
            ? {}
            : { unreadable: { error: trusting.unreadable, onRetry: () => void askTrust(trusting.projectId) } })}
          onDone={() => onCreated(trusting.projectId)}
        />
      </div>
    )
  if (draft === null || setup === null) return null
  const go = elsewhere.go
  // On another computer's home there's no picker and nothing dropped is there: its folders are those it found.
  const chooseFolder = () => void (home.remote ? undefined : model.choose())
  const pickedOnHome = draft.folders.flatMap((folder) => (folder.came === undefined && folder.found != null ? [folder.found] : []))
  const onHome = home.remote ? (
    <RepositoryPick
      repositories={
        found.data?.repositories.map((one) => ({
          id: one.id,
          name: one.name,
          where: one.where,
          facts: factsOf(one.branch, one.worked, now),
        })) ?? (found.isError ? [] : null)
      }
      picked={pickedOnHome}
      onPick={(id) => {
        const kept = draft.folders.find((folder) => folder.found === id)
        if (kept === undefined) void model.add(id)
        else model.leaveOut(kept.path)
      }}
      text={{ ...text.onHome(home.name), ...(found.isError ? { none: text.lookFailed(home.name) } : {}) }}
    />
  ) : undefined
  const onHomeWay =
    onHome !== undefined && found.isError ? (
      <>
        {onHome}
        <LinkButton onClick={() => void found.refetch()}>{text.lookAgain}</LinkButton>
      </>
    ) : (
      onHome
    )
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
          if (!home.remote) void model.drop(files)
        }}
        // Beside the folders chosen: what this computer has named like it, each added in a press. On another computer's home, its
        // list is the way in itself.
        found={setup.way === 'folder' && !home.remote ? model.found : null}
        onAdd={(id) => void model.add(id)}
        findings={model.findings}
        // A folder's host, not connected: its walk in, over the page, as a project's settings open it.
        onConnect={(host) => {
          const product = codeHostOf({ host, path: '' }, connections?.list ?? null).product
          setOpening(product === null ? 'all' : openingFor(connections?.list ?? null, product, host))
        }}
        side={
          <>
            <SetupSide
              setup={setup}
              draft={draft}
              creating={draft.creating}
              onChoose={chooseFolder}
              onLeaveOut={model.leaveOut}
              onReplace={(path) => void model.replace(path)}
              onStartFresh={() => void model.startFresh()}
              {...(home.remote ? { homeName: home.name, folderWay: onHomeWay } : { onChooseCloneInto: () => void model.chooseCloneInto() })}
              onOpenProject={onOpen}
              dropping={dropping && !home.remote}
            />
            {setup.way === 'folder' && elsewhere.tiles.length > 0 && (
              <section className={s.elsewhere} aria-label={elsewhereWords.heading}>
                <div className={s.elsewhereHead}>
                  <h2 className={s.elsewhereTitle}>{elsewhereWords.heading}</h2>
                  <p className={s.elsewhereLine}>{elsewhereWords.line}</p>
                </div>
                <OtherTools tiles={elsewhere.tiles} picked={elsewhere.picked} onPick={elsewhere.onPick} />
              </section>
            )}
          </>
        }
        {...(setup.footNote !== null
          ? { footNote: setup.footNote }
          : go === null || setup.way !== 'folder'
            ? {}
            : { footNote: elsewhereWords.andThen(go) })}
        // oxlint-disable-next-line althar/press-at-once -- A form the runtime and a code host check (a clone, a repository made there): it stays, each part ticking as it is done, until made, so a refusal lands in it.
        onCreate={() =>
          void model.create().then(async (made) => {
            if (made === null) return
            // What was picked comes in behind the tab, which opens on the project at once: its board shows each as it comes.
            if (setup.way === 'folder') void elsewhere.bring(made.id)
            // What its repositories' own agent settings run is asked first, where any runs something (DEV-280): a clone is
            // only there once made. Until answered, nothing of them is trusted, and a task's line offers them later.
            await askTrust(made.id)
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
        text={text.page(home.name)}
      />
      {opening !== null && connections !== undefined && (
        <ConnectDialog model={connections} opening={opening} onClose={() => setOpening(null)} />
      )}
    </div>
  )
}
