import { useRef, useState } from 'react'

import type { ConnectionList, Product, ProjectRepository, ProjectSummary } from '@althar/contracts'
import {
  Button,
  ControlCenter,
  ControlDetail,
  ControlFoot,
  ControlGrid,
  ControlMarks,
  ControlModule,
  type ControlPlace,
  ControlSheet,
  ControlToggle,
  ControlWords,
  Icon,
  ProjectIdentity,
  ProjectInk,
  projectIdentityText,
  ProjectMark,
  ProjectNotes,
  RemoveProject,
  RepositoryFiles,
  repositoryFilesWords,
} from '@althar/ui'

import { device } from '../../shared/device'
import { shortFolder } from '../../shared/folders'
import { productBrand, productName } from '../../shared/products'
import { connectedAs, type Host, hostMarksOf, hostNameOf, rulesLineOf, text as frontText, type Tracker } from './front'
import type { ProjectSettingsModel } from './useProjectSettings'

/*
 * A project's settings, from the Settings button at the top right of its
 * screen: the kit's Control Center, as the app's own Settings are, over
 * whichever view is shown. A module for its name and colour opens out, to
 * change them in place; the others say where each thing stands and open
 * where it is changed: its repositories, its rules, and connecting the code
 * host and tracker it is on. Beside the tracker, a switch for whether a task's
 * issue moves to In Progress as the task starts; beside its rules, one has
 * its leads resolve a conflict with the default branch unasked (ADR-030).
 * Whether skill and OpenSpec files a task commits may stay in its
 * repositories' commits, and be pushed, opens out to three switches, each
 * off until turned on.
 * The notes its coordinator keeps open out too, to read and drop one that no
 * longer holds (ADR-031). Removing it from Althar is at the foot, and asks
 * first. Nothing in it says what is running.
 */

export const text = {
  settings: 'Settings',
  label: (project: string) => `${project}’s settings`,
  identity: 'Name and colour',
  repositories: 'Repositories',
  rules: 'Rules',
  conflicts: 'Resolve conflicts automatically',
  conflictsOn: 'On: the lead fixes merge conflicts itself',
  conflictsOff: 'Off: you ask the lead to fix them',
  moveIssues: 'Move issues to In Progress when their task starts',
  moveIssuesOn: 'On: Althar moves the issue as its task starts',
  moveIssuesOff: 'Off: you move issues yourself',
  repositoryFiles: 'Repository files',
  notes: 'Notes',
  noNotes: 'None yet',
  connectedAs: (login: string) => `Connected as ${login}`,
  notConnected: 'Not connected',
  connect: 'Connect',
  remove: 'Remove from Althar',
}

/** The repository files' words, with this device named as the rest of the window names it. */
const filesText = repositoryFilesWords(device.this)

/** The runtime's name for each of the kit's inks. */
/** Where a module sits beside another, in the grid's four columns: the left half, or the right. */
const LEFT: ControlPlace = { column: [1, 3] }
const RIGHT: ControlPlace = { column: [3, 5] }
const ACROSS: ControlPlace = { column: [1, 5] }

const INK: Readonly<Record<ProjectInk, ProjectSummary['ink']>> = {
  [ProjectInk.Clay]: 'clay',
  [ProjectInk.Ochre]: 'ochre',
  [ProjectInk.Olive]: 'olive',
  [ProjectInk.Moss]: 'moss',
  [ProjectInk.Teal]: 'teal',
  [ProjectInk.Slate]: 'slate',
  [ProjectInk.Rose]: 'rose',
  [ProjectInk.Umber]: 'umber',
}

/** A project's ink as the kit has it. */
export const inkOf = (ink: ProjectSummary['ink']): ProjectInk =>
  Object.values(ProjectInk).find((one) => INK[one] === ink) ?? ProjectInk.Clay

export interface ProjectSettingsProps {
  model: ProjectSettingsModel
  /** What its mark is drawn from: its id. */
  seed: string
  /** Its repositories, each with its remote. */
  repositories: ReadonlyArray<ProjectRepository>
  /** The code hosts and trackers connected, and those Althar knows. */
  connections: ConnectionList | null
  /** The code host its repositories are on, as its coordinator's thread says. */
  host: Host | null
  /** The tracker its tasks name, where they name one. */
  tracker: Tracker | null
  onRepositories: () => void
  onRules: () => void
  /** Connects a code host or tracker, on the server by its host name: its walk in, or all of them where it is connected. */
  onConnect: (product: Product, at: string | null) => void
}

/** The settings' button and what it opens; the removal's question, once asked. */
export function ProjectSettings({
  model,
  seed,
  repositories,
  connections: list,
  host,
  tracker,
  onRepositories,
  onRules,
  onConnect,
}: ProjectSettingsProps) {
  const [open, setOpen] = useState(false)
  const [showing, setShowing] = useState<'all' | 'identity' | 'notes' | 'files'>('all')
  const name = model.name ?? ''
  const ink = inkOf(model.ink ?? 'clay')
  const taken: Partial<Record<ProjectInk, string>> = {}
  for (const one of Object.values(ProjectInk)) {
    const whose = model.taken[INK[one]]
    if (whose !== undefined) taken[one] = whose
  }
  const rules = model.rules === null ? null : rulesLineOf(model.rules)
  // Who Althar is connected as there: on that very server, not another of the same product.
  const hostLogin = host === null ? null : connectedAs(list, host.product, hostNameOf(host.webUrl))
  const trackerLogin = tracker === null ? null : connectedAs(list, tracker.product, tracker.at)
  // Each opened from the panel goes over the screen on its own, and gives focus back to the button when it closes.
  const button = useRef<HTMLButtonElement>(null)
  const leave = (then: () => void) => () => {
    button.current?.focus()
    setOpen(false)
    then()
  }

  return (
    <>
      <ControlCenter
        trigger={
          <Button ref={button} size="small" variant="quiet" icon="gear">
            {text.settings}
          </Button>
        }
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setShowing('all')
        }}
        onEscapeKeyDown={(event) => {
          // Escape steps back out of an opened module before it closes the panel, once a field has had its own.
          if (event.defaultPrevented || showing === 'all') return
          event.preventDefault()
          setShowing('all')
        }}
        text={{ label: text.label(name) }}
      >
        {showing === 'all' ? (
          <>
            <ControlGrid>
              <ControlModule title={text.identity} onClick={() => setShowing('identity')}>
                <ControlWords mark={<ProjectMark seed={seed} ink={ink} size={30} />} title={name} line={projectIdentityText.inks[ink]} />
              </ControlModule>
              <ControlModule
                title={text.repositories}
                aside={String(repositories.length)}
                {...(host === null && tracker === null ? {} : { place: LEFT })}
                onClick={leave(onRepositories)}
              >
                <ControlMarks marks={hostMarksOf(repositories)} />
              </ControlModule>
              {host !== null && (
                <ControlModule
                  title={host.name}
                  place={RIGHT}
                  {...(hostLogin === null ? { aside: text.connect } : {})}
                  onClick={leave(() => onConnect(host.product, hostNameOf(host.webUrl)))}
                >
                  <ControlWords
                    brand={productBrand(host.product)}
                    title={hostLogin === null ? text.notConnected : text.connectedAs(hostLogin)}
                  />
                </ControlModule>
              )}
              {tracker !== null && (
                <ControlModule
                  title={productName(tracker.product)}
                  place={host === null ? RIGHT : LEFT}
                  {...(trackerLogin === null ? { aside: text.connect } : {})}
                  onClick={leave(() => onConnect(tracker.product, tracker.at))}
                >
                  <ControlWords
                    brand={productBrand(tracker.product)}
                    title={trackerLogin === null ? text.notConnected : text.connectedAs(trackerLogin)}
                    line={frontText.issues(tracker.key)}
                  />
                </ControlModule>
              )}
              {model.rules !== null && (
                <ControlToggle
                  title={text.moveIssues}
                  line={
                    model.ruleFailed?.rule === 'moveIssues'
                      ? model.ruleFailed.message
                      : model.rules.moveIssues
                        ? text.moveIssuesOn
                        : text.moveIssuesOff
                  }
                  on={model.rules.moveIssues}
                  onChange={model.setMoveIssues}
                  glyph={<Icon name="play" size={16} />}
                  // Beside the tracker where the code host sits above it; across the panel where it would be alone.
                  place={host !== null && tracker !== null ? RIGHT : ACROSS}
                />
              )}
              <ControlModule title={text.rules} {...(model.rules === null ? {} : { place: LEFT })} onClick={leave(onRules)}>
                {rules !== null && <ControlWords title={rules.policy} line={rules.asks} />}
              </ControlModule>
              {model.rules !== null && (
                <ControlToggle
                  title={text.conflicts}
                  line={
                    model.ruleFailed?.rule === 'resolveConflicts'
                      ? model.ruleFailed.message
                      : model.rules.resolveConflicts
                        ? text.conflictsOn
                        : text.conflictsOff
                  }
                  on={model.rules.resolveConflicts}
                  onChange={model.setResolveConflicts}
                  glyph={<Icon name="branch" size={16} />}
                  place={RIGHT}
                />
              )}
              {model.rules !== null && (
                <ControlModule title={text.repositoryFiles} onClick={() => setShowing('files')}>
                  <ControlWords title={filesText.summary(model.rules.repositoryFiles)} />
                </ControlModule>
              )}
              {model.notes !== null && (
                <ControlModule
                  title={text.notes}
                  {...(model.notes.length === 0 ? {} : { aside: String(model.notes.length) })}
                  onClick={() => setShowing('notes')}
                >
                  <ControlWords title={model.notes.at(-1)?.body ?? text.noNotes} />
                </ControlModule>
              )}
            </ControlGrid>
            <ControlFoot>
              <Button size="small" variant="danger" icon="close" onClick={leave(model.askRemove)}>
                {text.remove}
              </Button>
            </ControlFoot>
          </>
        ) : showing === 'files' && model.rules !== null ? (
          <ControlDetail title={text.repositoryFiles} onBack={() => setShowing('all')}>
            <ControlSheet>
              <RepositoryFiles
                value={model.rules.repositoryFiles}
                onChange={model.setRepositoryFile}
                text={filesText}
                {...(model.ruleFailed?.rule === 'repositoryFiles' ? { error: model.ruleFailed.message } : {})}
              />
            </ControlSheet>
          </ControlDetail>
        ) : showing === 'notes' ? (
          <ControlDetail title={text.notes} onBack={() => setShowing('all')}>
            <ControlSheet>
              <ProjectNotes
                notes={model.notes ?? []}
                onRemove={(id) => void model.dropNote(id)}
                {...(model.noteFailed === null ? {} : { error: model.noteFailed })}
              />
            </ControlSheet>
          </ControlDetail>
        ) : (
          <ControlDetail title={text.identity} onBack={() => setShowing('all')}>
            <ControlSheet>
              <ProjectIdentity
                name={name}
                seed={seed}
                ink={ink}
                taken={taken}
                onRename={model.rename}
                onInk={(next) => model.setInk(INK[next])}
                {...(model.failed === null ? {} : { error: model.failed })}
              />
            </ControlSheet>
          </ControlDetail>
        )}
      </ControlCenter>
      {model.removing && model.project !== null && (
        <RemoveProject
          project={model.project.name}
          working={model.project.working}
          worktrees={model.project.worktrees === null ? null : shortFolder(model.project.worktrees)}
          busy={model.busy}
          {...(model.error === null ? {} : { error: model.error })}
          onRemove={() => void model.remove()}
          onClose={model.closeRemove}
        />
      )}
    </>
  )
}
