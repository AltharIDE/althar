// G · Tabs on top: a dialog from the front page with four tabs across its top, each short enough to need no scrolling; the switches on the first. No side nav.
import { useState } from 'react'

import { Dialog, Segmented } from '../../../src/index'
import { Block, calm as c, CodeAndIssues, Head, NoteLines, notesCount, RemoveLink, Shared, Switches, TaskLines } from '../calm'
import type { Things } from '../parts'
import { useProto } from '../state'

type Tab = 'general' | 'code' | 'tasks' | 'notes'

export function G({ things, onClose }: { things: Things; onClose: () => void }) {
  const p = useProto()
  const [tab, setTab] = useState<Tab>(p.showing === 'notes' ? 'notes' : 'general')
  const troubles = things.troubles
  return (
    <Dialog title={`${things.name} settings`} onClose={onClose} width={640}>
      <div className={c.tabs}>
        <Segmented<Tab>
          label="Part of its settings"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'general', label: 'General' },
            { value: 'code', label: troubles > 0 ? `Code and issues · ${troubles} needs you` : 'Code and issues' },
            { value: 'tasks', label: 'How tasks run' },
            { value: 'notes', label: `Notes · ${notesCount(things)}` },
          ]}
        />
        <div className={c.tabBody}>
          {tab === 'general' && (
            <>
              <Head things={things} size={36} />
              <Block title="Every task">
                <Switches things={things} />
              </Block>
              <div className={c.foot}>
                <span>Its repositories and branches stay where they are.</span>
                <RemoveLink things={things} />
              </div>
            </>
          )}
          {tab === 'code' && (
            <>
              <Block>
                <CodeAndIssues things={things} />
              </Block>
              <Shared things={things} />
            </>
          )}
          {tab === 'tasks' && (
            <Block>
              <TaskLines things={things} />
            </Block>
          )}
          {tab === 'notes' && (
            <Block>
              <NoteLines things={things} />
            </Block>
          )}
        </div>
      </div>
    </Dialog>
  )
}
