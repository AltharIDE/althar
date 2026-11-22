import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { MOST_AT_ONCE } from '@althar/contracts'
import { AddWorkerDialog, AgentsAtOnce, Computers, fewerOf, Problem, SettingList } from '@althar/ui'

import { useServices } from '../../data/services'
import { usePlaces } from '../../shared/usePlaces'
import { computerWorkerOf, useRemoveWorker, useWorkers } from '../../shared/useWorkers'
import { useWindowHome } from '../homes/windowHome'
import type { StartModel } from '../start/useStart'
import { EVERY, glanceOf, SLOTS } from '../tabs/useLoad'
import s from './Settings.module.css'
import { text } from './text'
import { useAgentsAtOnce } from './useAgentsAtOnce'

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
 * reads: in a window on a Linux home, that home by its name, the commands
 * that add a worker to it there, and Remove only where this connection may.
 */

export function ComputersSection({
  start,
  opened,
  onOpen,
  onTask,
}: {
  start: StartModel
  /** The computer opened out: the home (`HOME`) or a worker, by its id; null for all of them. */
  opened: string | null
  onOpen: (id: string | null) => void
  onTask?: ((threadId: string) => void) | undefined
}) {
  const { client } = useServices()
  const reading = useQuery({
    queryKey: ['load'],
    queryFn: () => client.getLoad(),
    refetchInterval: EVERY,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  })
  const places = usePlaces(true)
  const workers = useWorkers(true)
  const removing = useRemoveWorker()
  const atOnce = useAgentsAtOnce()
  const [adding, setAdding] = useState(false)
  const here = useWindowHome()
  const names = new Map((start.status?.agents ?? []).map((agent) => [agent.id, agent.name]))
  return (
    <>
      <Computers
        home={{ name: here.name, load: reading.data === undefined ? null : glanceOf(reading.data), agents: places }}
        workers={
          workers === null
            ? null
            : { enabled: workers.enabled, list: workers.workers.map((one) => computerWorkerOf(one, (id) => names.get(id) ?? id)) }
        }
        opened={opened}
        onOpen={onOpen}
        onAdd={() => setAdding(true)}
        onRemove={(id) => {
          onOpen(null)
          removing.remove(id)
        }}
        canRemove={here.canRemoveWorkers}
        onTask={onTask}
        homeSettings={
          atOnce === null ? null : (
            <SettingList>
              <AgentsAtOnce
                count={atOnce.atOnce.count}
                own={atOnce.atOnce.own !== null}
                machine={atOnce.atOnce.machine}
                most={MOST_AT_ONCE}
                onChange={atOnce.set}
                fewer={places === null ? null : fewerOf(places)}
                text={{ note: text.atOnceNote, mark: text.atOnceMark, value: text.atOnceValue }}
              />
            </SettingList>
          )
        }
        slots={SLOTS}
      />
      {removing.failed !== null && <Problem className={s.failed}>{removing.failed}</Problem>}
      {atOnce?.failed === true && <Problem className={s.failed}>{text.failed}</Problem>}
      {adding && (
        <AddWorkerDialog
          home={here.name}
          enabled={workers?.enabled ?? false}
          standalone={here.standalone}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  )
}
