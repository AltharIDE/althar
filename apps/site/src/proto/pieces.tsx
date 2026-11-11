import {
  CanvasPanel,
  ChangeTrack,
  DictationPill,
  LoadPeek,
  PageFrame,
  PagePanel,
  ServerTiles,
  SettingList,
  SkillTiles,
  TaskFolders,
} from '@althar/ui'
import type { ReactNode } from 'react'

import * as load from '../../../../packages/ui/src/fixtures/load'
import * as outputs from '../../../../packages/ui/src/fixtures/outputs'
import * as pages from '../../../../packages/ui/src/fixtures/pages'
import * as tools from '../../../../packages/ui/src/fixtures/tools'
import { Shot } from '../home/bodies/kit/Shot'
import { renamed } from '../home/bodies/kit/world'
import s from './pieces.module.css'

/*
 * The features the flow doesn't show yet, each a piece of the app drawn by
 * its own components from the kit's demo world (said the site's way, as
 * kit/world.ts does). Pictures: nothing in them can be pressed.
 */

const none = () => {}
const { LOAD_BUSY, LOAD_SLOTS } = renamed({ ...load })
const { TRACK_QUEUED } = renamed({ ...outputs })
const { SERVERS, SERVER_SYNC, SKILLS, SKILL_SYNC, TOOL_AGENTS, TOOL_PROJECTS } = renamed({ ...tools })
const { PAGE } = pages

const GB = 1024 ** 3

/** A page the lead drew on the canvas: the refund's status, as the partner sees it, with the next retry it is waiting for. */
const DRAWN = `<!doctype html><html><head><style>
  body { margin: 0; font: 14px Inter, system-ui, sans-serif; background: #f4f2ec; color: #141417; display: grid; place-items: center; min-height: 100vh }
  .card { width: 380px; padding: 26px 28px; border-radius: 16px; background: #fff; box-shadow: 0 1px 2px rgba(60,50,30,.06), 0 14px 30px -14px rgba(60,50,30,.18) }
  .k { font: 500 11px ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; color: #85858b }
  h1 { font-size: 22px; margin: 6px 0 2px; letter-spacing: -.02em } .sum { margin: 0 0 20px; color: #63636b }
  .wait { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 10px; background: #f6f1e8; margin-bottom: 18px }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #e39c4a; box-shadow: 0 0 0 4px rgba(227,156,74,.18) }
  .wait b { display: block } .wait span { color: #63636b; font-size: 13px }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px } li { display: flex; justify-content: space-between; color: #63636b }
  li b { color: #141417; font-weight: 500 } .ok { color: #2f8a4b }
</style></head><body><div class="card"><div class="k">Refund re_3Pq · order 88210</div><h1>€42.00 to Northwind</h1>
<p class="sum">Sent once. The partner asked us to wait before trying again.</p>
<div class="wait"><i class="dot"></i><div><b>Next try at 14:32</b><span>Retry-After: 120 seconds, as the partner said</span></div></div>
<ol><li><b>Created</b><span>14:28</span></li><li><b>Webhook answered 429</b><span>14:30</span></li><li><b>Idempotency key</b><span class="ok">kept</span></li></ol>
</div></body></html>`

const VIEWPORTS = [
  { value: 'fit', label: 'Fit the panel' },
  { value: 'desktop', label: 'Desktop', hint: '1440 × 900' },
  { value: 'phone', label: 'Phone', hint: '390 × 844' },
] as const

export interface Piece {
  id: string
  title: ReactNode
  lead: string
  /** The icon a compact list shows it by (the kit's Icon names). */
  icon: 'mic' | 'pr' | 'load' | 'knowledge' | 'plug' | 'folder' | 'canvas' | 'globe'
  piece: ReactNode
}

export const CANVAS: Piece = {
  id: 'canvas',
  icon: 'canvas',
  title: (
    <>
      It draws it out. <b>You mark it up.</b>
    </>
  ),
  lead: 'Leads draw pages, diagrams and pictures on the project’s canvas. Comment on what’s there, and the next version answers it.',
  piece: (
    <Shot
      w={600}
      h={600}
      maxScale={1.1}
      label="A page the lead drew on the canvas: a refund waiting on Retry-After, version 3, a comment answered"
      frame={s.panel}
    >
      <div className={s.canvas}>
        <CanvasPanel
          name="refund-status"
          title="Refund status"
          kind="html"
          fill
          version={3}
          latest={3}
          by="The lead of Honour Retry-After · 4 min ago"
          note="Shows when the next try is"
          comments={[
            {
              id: 'c1',
              version: 2,
              body: 'Say when it tries again, not just that it’s waiting.',
              place: 'Whole canvas',
              answered: true,
              answer: 'Added in v3.',
            },
          ]}
          onComment={none}
          onReload={none}
          onClose={none}
        >
          <iframe title="Refund status" className={s.page} srcDoc={DRAWN} />
        </CanvasPanel>
      </div>
    </Shot>
  ),
}

export const BROWSER: Piece = {
  id: 'browser',
  icon: 'globe',
  title: (
    <>
      See it running. <b>Point at what’s off.</b>
    </>
  ),
  lead: 'The page a task is building opens beside it, in a browser of its own. Point at what’s wrong; the lead sees what you see, and can drive the page itself.',
  piece: (
    <Shot w={640} h={600} maxScale={1.1} label="The refunds page, open beside its task, with the lead at work on it" frame={s.panel}>
      <div className={s.browser}>
        <PagePanel
          address="localhost:5173/refunds"
          full="http://localhost:5173/refunds"
          canBack
          canForward={false}
          onBack={none}
          onForward={none}
          onReload={none}
          onNavigate={none}
          keep="until the task is done"
          onClear={none}
          viewport="fit"
          viewports={VIEWPORTS}
          onViewport={none}
          onComment={none}
          onClose={none}
        >
          <PageFrame still={PAGE} />
        </PagePanel>
      </div>
    </Shot>
  ),
}

export const VOICE: Piece = {
  id: 'voice',
  icon: 'mic',
  title: (
    <>
      Say it. <b>Don’t type it.</b>
    </>
  ),
  lead: 'Dictate to the coordinator or any task. It’s transcribed on your computer, by a model downloaded once.',
  piece: (
    <Shot w={520} maxScale={1.2} label="Dictating to the coordinator: seven seconds in, the words as they come" frame={s.card}>
      <div className={s.pad}>
        <DictationPill
          phase="listening"
          to="To the coordinator · Tally"
          elapsed="0:07"
          levels={[0.2, 0.5, 0.8, 0.4, 0.9, 0.6, 0.3, 0.7, 0.5, 0.2, 0.6, 0.4]}
          words="and when a partner sends Retry-After, wait that long before the next refund webhook"
          onStop={none}
          onDiscard={none}
          onBack={none}
        />
      </div>
    </Shot>
  ),
}

export const QUEUE: Piece = {
  id: 'queue',
  icon: 'pr',
  title: (
    <>
      Through the merge queue, <b>in order.</b>
    </>
  ),
  lead: 'Changes across repositories merge bottom-up, through your host’s merge queue, each waiting for the one it builds on.',
  piece: (
    <Shot
      w={360}
      crop={{ x: 0, y: 0, w: 360, h: 200 }}
      maxScale={1.2}
      label="Two changes in merge order: the first in the merge queue, the second merging after it"
      frame={s.card}
    >
      <div className={s.pad}>
        <ChangeTrack stops={TRACK_QUEUED} />
      </div>
    </Shot>
  ),
}

export const LOAD: Piece = {
  id: 'load',
  icon: 'load',
  title: (
    <>
      Your machine, <b>at a glance.</b>
    </>
  ),
  lead: 'What each task takes of your CPU and memory, live, from the window’s bar.',
  piece: (
    <Shot
      w={300}
      crop={{ x: 0, y: 0, w: 300, h: 270 }}
      maxScale={1.25}
      label="This computer’s load: four tasks, their CPU and memory"
      frame={s.card}
    >
      <LoadPeek load={LOAD_BUSY} slots={LOAD_SLOTS} />
    </Shot>
  ),
}

export const SKILLS_PIECE: Piece = {
  id: 'skills',
  icon: 'knowledge',
  title: (
    <>
      One set of skills. <b>Every agent.</b>
    </>
  ),
  lead: 'Add a skill once, from a folder or GitHub. Claude Code, Codex and OpenCode all get it, and stay the same.',
  piece: (
    <Shot
      w={560}
      crop={{ x: 0, y: 0, w: 560, h: 340 }}
      maxScale={1}
      label="Skills, the same in Claude Code, Codex and OpenCode"
      frame={s.panel}
    >
      <div className={s.pad}>
        <SkillTiles
          skills={SKILLS}
          agents={TOOL_AGENTS}
          projects={TOOL_PROJECTS}
          sync={SKILL_SYNC}
          onRoles={none}
          onSync={none}
          onAdd={none}
        />
      </div>
    </Shot>
  ),
}

export const SERVERS_PIECE: Piece = {
  id: 'servers',
  icon: 'plug',
  title: (
    <>
      MCP servers, <b>set up once.</b>
    </>
  ),
  lead: 'Connect a server once, and every agent’s own config gets it. Anything it changed, you can undo.',
  piece: (
    <Shot w={560} crop={{ x: 0, y: 0, w: 560, h: 340 }} maxScale={1} label="MCP servers, kept the same in every agent" frame={s.panel}>
      <div className={s.pad}>
        <ServerTiles
          servers={SERVERS}
          agents={TOOL_AGENTS}
          projects={TOOL_PROJECTS}
          sync={SERVER_SYNC}
          onRoles={none}
          onSync={none}
          onAdd={none}
          onUndo={none}
        />
      </div>
    </Shot>
  ),
}

export const STORAGE: Piece = {
  id: 'storage',
  icon: 'folder',
  title: (
    <>
      Disk space, <b>looked after.</b>
    </>
  ),
  lead: 'Finished tasks’ folders go after a while, sooner when the disk fills. Anything not yet pushed is held back.',
  piece: (
    <Shot w={560} maxScale={1} label="Task folders: 9.5 GB can go now, 7 GB held back" frame={s.card}>
      <div className={s.pad}>
        <SettingList>
          <TaskFolders
            wait="smart"
            onWait={none}
            disk={{ total: 460 * GB, used: 429 * GB }}
            goes={[
              { id: 't1', title: 'Sign webhook v2 payloads with rotating keys', kind: 'merged', when: 'today', bytes: 2.4 * GB },
              { id: 't2', title: 'Audit third-party script loading', kind: 'done', when: 'yesterday', bytes: 2.1 * GB },
              { id: 't3', title: 'Add idempotency keys to the refund endpoint', kind: 'merged', when: '2 days ago', bytes: 2.3 * GB },
              { id: 't4', title: 'Reduce cold start on the checkout worker', kind: 'abandoned', when: '5 days ago', bytes: 2.7 * GB },
            ]}
            held={[
              {
                id: 'h1',
                title: 'Document the webhook retry contract',
                kind: 'done',
                when: '9 days ago',
                bytes: 2.3 * GB,
                why: 'unpushed',
                count: 4,
              },
              {
                id: 'h2',
                title: 'Backfill idempotency keys on refunds',
                kind: 'merged',
                when: '12 days ago',
                bytes: 4.7 * GB,
                why: 'running',
              },
            ]}
            onCleanUp={none}
            onRemove={none}
          />
        </SettingList>
      </div>
    </Shot>
  ),
}

/** The small ones, in the order they read. */
export const SMALL: Piece[] = [VOICE, QUEUE, SKILLS_PIECE, SERVERS_PIECE, LOAD, STORAGE]
