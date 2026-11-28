import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

import { MOST_AT_ONCE } from '@althar/contracts'
import {
  AddWorkerByHandDialog,
  AddWorkerDialog,
  AgentsAtOnce,
  Button,
  Computers,
  fewerOf,
  PhoneList,
  Problem,
  SettingGroup,
  SettingList,
} from '@althar/ui'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { useNow } from '../../shared/time'
import { usePlaces } from '../../shared/usePlaces'
import { computerWorkerOf, useRemoveWorker, useWorkerProjects, useWorkersRead, useWorkerSignIn } from '../../shared/useWorkers'
import { useNewestWorkerRelease, usePressed, useWorkerUpdates, withIntents, workerUpdateOf } from '../../shared/workerUpdates'
import { useAddWorker } from './useAddWorker'
import { homesUi, useHomesUi } from '../homes/useHomes'
import { useWindowHome } from '../homes/windowHome'
import { PhonesDialog } from '../phones/PhonesDialog'
import { phoneOf, usePairedPhones } from '../phones/usePairing'
import type { StartModel } from '../start/useStart'
import { EVERY, glanceOf, SLOTS } from '../tabs/useLoad'
import s from './Settings.module.css'
import { text } from './text'
import { useAgentsAtOnce } from './useAgentsAtOnce'
import { HomeSettings } from './HomeSettings'
import { device } from '../../shared/device'

/*
 * Settings › Computers: where the home's agents run (ADR-103). The home, with
 * its readings as its load popover has them and, opened out, its Agents at
 * once; its workers, each where it stands, opened out to what it runs, what
 * it has free, what it is, and taking it out; and Add a worker, which says
 * what it takes. What is opened out is in the address (`worker`), so the
 * popover's row for a worker opens it here. The home is read every three
 * seconds while the section shows, as the meter reads it; so are its workers.
 * Althar Cloud's line and page (the kit's `CloudLine`, `CloudPage`) join it
 * once a home has Althar Cloud; none has yet. It is the window's home it
 * reads: in a window on a Linux home, that home by its name. Adding a worker
 * (`useAddWorker`), picking its projects and taking it out are where this
 * connection may; its agents sign in from here over the SSH address it was
 * set up at. A home that takes workers only by its operator's certificates
 * gets the commands that add one by hand.
 * Under them, the phones paired with the home, each with Remove, and Pair a
 * phone…, the Computers menu's own dialog. Add a worker…, from that menu,
 * opens its dialog here.
 */

export function ComputersSection({
  start,
  opened,
  onOpen,
  onTask,
  folders,
}: {
  start: StartModel
  /** The computer opened out: the home (`HOME`) or a worker, by its id; null for all of them. */
  opened: string | null
  onOpen: (id: string | null) => void
  onTask?: ((threadId: string) => void) | undefined
  /** A home's finished tasks' folders, on its disk: under it, opened out, after its agents at once. */
  folders?: ReactNode
}) {
  const { client, host } = useServices()
  const reading = useQuery({
    queryKey: ['load'],
    queryFn: () => client.getLoad(),
    refetchInterval: EVERY,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  })
  const places = usePlaces(true)
  const workersRead = useWorkersRead(true)
  // What was pressed, held over the reads until one confirms it.
  const pressed = usePressed()
  const workers = withIntents(workersRead.data ?? null, pressed.intents)
  const removing = useRemoveWorker()
  const picking = useWorkerProjects()
  const signing = useWorkerSignIn()
  // Each worker's update, against the newest worker release: asked from here, or from the bar's Updates.
  const newest = useNewestWorkerRelease()
  const updates = useWorkerUpdates()
  const atOnce = useAgentsAtOnce()
  const [adding, setAdding] = useState(false)
  // Add a worker…, from the Computers menu: open here as the section shows.
  const { addWorker } = useHomesUi()
  useEffect(() => {
    if (!addWorker) return
    homesUi.set({ addWorker: false })
    setAdding(true)
  }, [addWorker])
  const [pairing, setPairing] = useState(false)
  const phones = usePairedPhones()
  const now = useNow(false)
  const here = useWindowHome()
  const projects = useQuery({ ...reads(client).projects(), enabled: here.canManageWorkers })
  const allProjects = (projects.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name }))
  const added = useCallback(
    (workerId: string) => {
      setAdding(false)
      onOpen(workerId)
    },
    [onOpen],
  )
  const adder = useAddWorker({ open: adding, here: !here.standalone, workers, onClose: () => setAdding(false), added })
  const names = new Map((start.status?.agents ?? []).map((agent) => [agent.id, agent.name]))
  // Its agents sign in over the SSH address the home gives, with the person's own SSH: only from a window that may manage
  // the home's workers, as this computer's own home or one reached over SSH is, never one paired over the network.
  const signsIn = host.workers !== undefined && here.canManageWorkers
  const confirmed = signing.confirmed
  useEffect(() => {
    if (workers !== null) confirmed(workers.workers)
  }, [confirmed, workers])
  return (
    <>
      <Computers
        home={{ name: here.name, load: reading.data === undefined ? null : glanceOf(reading.data), agents: places }}
        workers={
          workers === null
            ? null
            : {
                enabled: workers.enabled,
                list: workers.workers.map((one) => {
                  const update = workerUpdateOf(one, newest, pressed.refused.get(one.workerId), pressed.cancelRefused.get(one.workerId))
                  return {
                    ...computerWorkerOf(
                      signing.held.has(one.workerId) ? { ...one, signedIn: signing.held.get(one.workerId) ?? [] } : one,
                      (id) => names.get(id) ?? id,
                      signsIn,
                    ),
                    ...(one.release === undefined ? {} : { release: one.release }),
                    ...(update === undefined ? {} : { update }),
                  }
                }),
              }
        }
        opened={opened}
        onOpen={onOpen}
        onAdd={() => setAdding(true)}
        onRemove={(id) => {
          onOpen(null)
          removing.remove(id)
        }}
        canRemove={here.canManageWorkers}
        {...(here.olderHome ? { text: { removeElsewhere: text.olderHome } } : {})}
        onTask={onTask}
        onUpdate={updates.update}
        onCancelUpdate={updates.cancel}
        {...(newest === null ? {} : { newest })}
        allProjects={allProjects}
        {...(here.canManageWorkers
          ? {
              onProjects: (workerId: string, ids: readonly string[]) =>
                picking.set(
                  workerId,
                  allProjects.filter((project) => ids.includes(project.id)),
                ),
            }
          : {})}
        {...(!signsIn
          ? {}
          : {
              onSignIn: (workerId: string, agent: string) => {
                const worker = workers?.workers.find((one) => one.workerId === workerId)
                if (worker !== undefined) signing.start(worker, agent)
              },
              signingIn: signing.signingIn,
              onPaste: signing.paste,
              onCancelSignIn: signing.cancel,
              onOpenLink: (url: string) => window.open(url, '_blank', 'noopener'),
            })}
        homeSettings={
          atOnce === null && folders === undefined ? null : (
            <HomeSettings inset>
              {atOnce !== null && (
                <SettingList>
                  <AgentsAtOnce
                    count={atOnce.atOnce.count}
                    own={atOnce.atOnce.own !== null}
                    machine={atOnce.atOnce.machine}
                    most={MOST_AT_ONCE}
                    onChange={atOnce.set}
                    disabled={!atOnce.canSet}
                    fewer={places === null ? null : fewerOf(places)}
                    // Named by the home it's about: This Mac's, or runner-1's.
                    text={text.atOnce(here.standalone ? here.name : device.this)}
                  />
                </SettingList>
              )}
              {folders}
            </HomeSettings>
          )
        }
        slots={SLOTS}
      />
      <SettingGroup
        title="Phones"
        headingLevel={2}
        action={
          <Button size="small" variant="quiet" onClick={() => setPairing(true)}>
            Pair a phone…
          </Button>
        }
      >
        {phones.devices === null ? null : phones.devices.length === 0 ? (
          <p className={s.quiet}>No phones paired with {here.name} yet.</p>
        ) : (
          <PhoneList
            home={here.name}
            phones={phones.devices.map((device) => phoneOf(device, now, phones.fresh))}
            onRemove={phones.remove}
          />
        )}
        {phones.problem !== null && <Problem className={s.failed}>{phones.problem}</Problem>}
      </SettingGroup>
      {pairing && <PhonesDialog home={here.name} onClose={() => setPairing(false)} />}
      {removing.failed !== null && <Problem className={s.failed}>{removing.failed}</Problem>}
      {picking.failed !== null && <Problem className={s.failed}>{picking.failed}</Problem>}
      {atOnce?.failed === true && <Problem className={s.failed}>{text.failed}</Problem>}
      {/* Asked before the home's workers are read, as from the Computers menu: held until they are, to pick the right way to add one. */}
      {adding && workers === null && workersRead.isError && (
        <Problem
          className={s.failed}
          action={
            <>
              <Button size="small" onClick={() => void workersRead.refetch()} disabled={workersRead.isFetching}>
                {text.workersAgain}
              </Button>
              <Button size="small" variant="quiet" onClick={() => setAdding(false)}>
                {text.workersCancel}
              </Button>
            </>
          }
        >
          {text.workersUnread(here.name)}
        </Problem>
      )}
      {adding && workers?.adds === true && here.canManageWorkers && (
        <AddWorkerDialog
          home={here.name}
          way={adder.way}
          onWay={adder.setWay}
          ssh={adder.ssh}
          address={adder.address}
          onAddress={adder.setAddress}
          addressError={adder.addressError}
          onAdd={adder.add}
          setup={adder.setup}
          onTrust={adder.trust}
          onAgain={adder.again}
          onStop={adder.stop}
          onCheckWorker={adder.checkWorker}
          onAllow={adder.allow}
          code={adder.code}
          unavailable={adder.unavailable}
          onCheck={adder.check}
          checking={adder.checking}
          onClose={adder.close}
        />
      )}
      {adding && workers !== null && (workers.adds !== true || !here.canManageWorkers) && (
        <AddWorkerByHandDialog home={here.name} enabled={workers.enabled} standalone={here.standalone} onClose={() => setAdding(false)} />
      )}
    </>
  )
}
