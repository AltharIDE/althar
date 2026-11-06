// Scrappy, surface 5, sketches: a task's parts on its header with + Add; a review that says whether it runs the code; a push an agent made with its own sign-in; and where a lead-started task came from.
import { useState } from 'react'

import { ChromeButton } from '../../../../src/chrome/ChromeButton/ChromeButton'
import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { Button } from '../../../../src/primitives/Button/Button'
import { Menu, MenuItem, MenuSeparator } from '../../../../src/primitives/Menu/Menu'
import { AltharLine } from '../../../../src/thread/AltharLine/AltharLine'
import { PARENT } from '../../data'
import s from './parts.module.css'

/** The task's parts, as chips on its header: where it works, its pull requests, its review drafts; + Add for another. */
export function Parts({ review = false }: { review?: boolean }) {
  return (
    <span className={s.parts}>
      {review ? (
        <ChromeButton icon="answer" label="Review draft" />
      ) : (
        <>
          <ChromeButton icon="folder" label="Worktree" />
          <ChromeButton icon="pr" label="#638" />
          <ChromeButton icon="answer" label="Review of #612" />
        </>
      )}
      <Menu label="Add to this task" width={280} trigger={<ChromeButton icon="plus" label="Add" />}>
        <MenuItem icon="folder" description="Its own checkout, to change code in" onSelect={() => undefined}>
          A worktree
        </MenuItem>
        <MenuItem icon="pr" description="Opened from its branch, or one that exists" onSelect={() => undefined}>
          A pull request
        </MenuItem>
        <MenuItem icon="answer" description="A draft of a review of any pull request" onSelect={() => undefined}>
          A review
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="lock" description="What its lead may run and reach" onSelect={() => undefined}>
          Access
        </MenuItem>
      </Menu>
    </span>
  )
}

/** A review's own line under its header: whether it runs the code it reads, and Run it where it doesn't. */
export function ReviewHead({ outside }: { outside: boolean }) {
  const [running, setRunning] = useState(false)
  if (!outside || running)
    return (
      <p className={s.reviewHead}>
        <Icon name="play" size={12} />
        <span>Runs its code here, in a worktree: tests, the app, Storybook.</span>
      </p>
    )
  return (
    <p className={s.reviewHead}>
      <Icon name="lock" size={12} />
      <span>
        Read only: <strong>ninemate</strong> isn’t a member of AltharIDE, so their code doesn’t run here.
      </span>
      <Button size="small" variant="quiet" icon="play" onClick={() => setRunning(true)}>
        Run it
      </Button>
    </p>
  )
}

/** Where a task its parent's lead started came from, as its thread opens. */
export function Origin() {
  return (
    <AltharLine text={{ name: 'Started by' }} className={s.origin}>
      the lead of{' '}
      <a href="#/threads/th-adr" className={s.link}>
        {PARENT.title}
      </a>
      , from your words there.
    </AltharLine>
  )
}

/** A push the lead made itself, signed in with the person's gh, as Althar shows it once it sees it on the host. */
export function SelfPush() {
  return (
    <div className={s.selfPush}>
      <p className={s.pushHead}>
        <BrandMark brand={Brand.GitHub} size={12} />
        <span>
          The lead pushed <strong>2 commits</strong> itself, with <code>gh</code> as balazs
        </span>
        <a className={s.link} href="https://github.com/AltharIDE/althar/compare/main...althar/codex-leads-reach-the-network-in-their-shell">
          Compare
        </a>
      </p>
      <ul className={s.commits}>
        <li>
          <code>3f2a91c</code> Drop network_access = false from Codex’s config
        </li>
        <li>
          <code>8be0d47</code> Take out the plain-curl reading rule
        </li>
      </ul>
      <p className={s.pushNote}>Not through Althar, so nothing held it. Althar saw it on GitHub at 14:02.</p>
    </div>
  )
}
