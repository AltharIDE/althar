import { useRef, useState } from 'react'
import { Button, Caret, CopyButton, Dialog, Field, Icon, IconButton, ListMotion, Problem, Spinner } from '@althar/ui'

import type { HomesHost } from '../../../../src/homes'
import type { LabHome } from '../../world'
import { OptionFields, Refusal, useHomes } from '../parts'
import s from './two.module.css'
import {
  Forgotten,
  HomeDot,
  type ManageProps,
  NameField,
  openFrom,
  Projects,
  shortId,
  useEdit,
  useForget,
  useLiveness,
  useQuietFocus,
  useStatus,
} from './shared'

/*
 * Manage 2 · Title blocks. Althar's mark is the section of an architect's
 * scale ruler; here each home is the corner of a drawing sheet, its title
 * block: ruled cells, each a fact under a small label (the home, how it
 * stands, its host, the projects on it, its identity). Nothing opens: a
 * cell that can change is changed where it is. The name is typed over; a
 * new host is checked as Enter is pressed, and the identity cell answers,
 * the same home or another. Open and Forget sit at the block's corner,
 * shown as it's pointed at.
 */

export function BlocksManage({ homes, windowId, onClose, onConnect }: ManageProps) {
  const saved = useHomes()
  const forgetting = useForget(homes)
  const shown = saved.filter((home) => !forgetting.hidden.has(home.id))
  const list = useRef<HTMLUListElement>(null)
  useQuietFocus(list)
  return (
    <Dialog title="Homes" width={640} tall onClose={onClose} actions={<Button onClick={onClose}>Done</Button>}>
      <ListMotion within={list} enter="grow">
        <ul className={s.sheets} ref={list}>
          {shown.map((home) => (
            <Block
              key={home.id}
              home={home}
              homes={homes}
              windowId={windowId}
              onClose={onClose}
              onForget={() => forgetting.forget(home, saved.indexOf(home))}
            />
          ))}
          <li data-move="add">
            <button type="button" className={s.blank} onClick={onConnect}>
              <Icon name="plus" size={14} />
              Connect a home
            </button>
          </li>
        </ul>
      </ListMotion>
      <Forgotten forgetting={forgetting} className={s.undo} />
    </Dialog>
  )
}

function Block({
  home,
  homes,
  windowId,
  onClose,
  onForget,
}: {
  home: LabHome
  homes: HomesHost
  windowId: string
  onClose: () => void
  onForget: () => void
}) {
  const edit = useEdit(homes, home)
  const live = useLiveness(home)
  const status = useStatus(home, windowId)
  const [options, setOptions] = useState(false)
  const here = home.id === windowId
  const { form } = edit
  const host = form.target.trim()
  const same = edit.kept && !edit.dirty
  return (
    <li data-move={home.id}>
      <section className={s.block} data-live={live === 'live' || undefined} aria-label={home.name}>
        <div className={`${s.cell} ${s.home}`}>
          <span className={s.label}>Home</span>
          <NameField key={home.id} home={home} className={s.name} />
        </div>
        <div className={`${s.cell} ${s.stands}`}>
          <span className={s.label}>Status</span>
          <span className={s.status} data-down={status.down || undefined}>
            <HomeDot state={live} />
            {status.words}
          </span>
          <span className={s.corner}>
            {!here && (
              <IconButton
                icon="external"
                label={`Open ${home.name}`}
                size="small"
                tooltipAlign="end"
                onClick={() => openFrom(homes, home.id, onClose)}
              />
            )}
            <IconButton icon="remove" label={`Forget ${home.name}`} size="small" tone="danger" tooltipAlign="end" onClick={onForget} />
          </span>
        </div>
        <div className={s.cell}>
          <span className={s.labelRow}>
            <label className={s.label} htmlFor={`host-${home.id}`}>
              SSH host
            </label>
            <button type="button" className={s.toggle} aria-expanded={options} onClick={() => setOptions((was) => !was)}>
              Options <Caret />
            </button>
          </span>
          <Field
            id={`host-${home.id}`}
            className={s.host}
            value={form.target}
            invalid={form.phase === 'refused'}
            spellCheck={false}
            autoComplete="off"
            data-own-escape
            onChange={(event) => form.setTarget(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && edit.dirty) {
                event.preventDefault()
                edit.save()
              }
              if (event.key === 'Escape' && edit.dirty) {
                event.preventDefault()
                edit.reset()
              }
            }}
          />
        </div>
        <div className={s.cell}>
          <span className={s.label}>Projects</span>
          <Projects on={home.id} live={live === 'live'} max={2} className={s.projects} />
        </div>
        <div className={s.cell}>
          <span className={s.label}>Identity</span>
          {edit.checking ? (
            <span className={s.answer} role="status">
              <Spinner size="small" />
              Checking…
            </span>
          ) : edit.other !== null ? (
            <span className={s.answer} data-tone="other">
              <code>{shortId(edit.other.homeId)}</code>
              <span>Another home</span>
            </span>
          ) : same ? (
            <span className={s.answer} role="status">
              <Icon name="check" size={13} />
              Same home
            </span>
          ) : (
            <span className={s.id}>
              <code title={home.homeId}>{shortId(home.homeId)}</code>
              <CopyButton value={home.homeId} className={s.copy} />
            </span>
          )}
        </div>
        {options && (
          <div className={`${s.cell} ${s.wide}`}>
            <span className={s.label}>Connection options</span>
            <OptionFields form={form} className={s.options} />
          </div>
        )}
        {(edit.other !== null || form.phase === 'refused' || edit.problem !== null || (edit.dirty && !edit.checking)) && (
          <div className={`${s.cell} ${s.wide} ${s.foot}`}>
            {form.phase === 'refused' && form.problem !== null && <Refusal problem={form.problem} />}
            {edit.problem !== null && <Refusal problem={edit.problem} />}
            {edit.other !== null ? (
              <Problem
                size="small"
                action={
                  <Button size="small" onClick={edit.saveNew}>
                    Save as a new home
                  </Button>
                }
              >
                {`${host} has a different home. ${home.name} stays on ${home.ssh.target}.`}
              </Problem>
            ) : (
              edit.dirty &&
              !edit.checking && (
                <span className={s.actions}>
                  <Button size="small" variant="quiet" onClick={edit.reset}>
                    Cancel
                  </Button>
                  <Button size="small" variant="signal" onClick={edit.save}>
                    Check and save
                  </Button>
                </span>
              )
            )}
          </div>
        )}
      </section>
    </li>
  )
}
