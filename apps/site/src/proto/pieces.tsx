import type { ReactNode } from 'react'

import {
  BrowserDrawing,
  CanvasDrawing,
  LoadDrawing,
  QueueDrawing,
  ServersDrawing,
  SkillsDrawing,
  StorageDrawing,
  VoiceDrawing,
} from './drawn'

/*
 * The features the flow doesn't show yet: their claim, their line, and their
 * drawing (drawn.tsx), flat or laid back in 3D.
 */

export interface Piece {
  id: string
  title: ReactNode
  lead: string
  draw: (tilt?: boolean) => ReactNode
}

export const CANVAS: Piece = {
  id: 'canvas',
  title: (
    <>
      It draws it out. <b>You mark it up.</b>
    </>
  ),
  lead: 'Leads draw pages, prototypes and diagrams on the project’s canvas: anything HTML and CSS can be. Comment on it, and the next version answers.',
  draw: (tilt) => <CanvasDrawing tilt={tilt} />,
}

export const BROWSER: Piece = {
  id: 'browser',
  title: (
    <>
      See it running. <b>Point at what’s off.</b>
    </>
  ),
  lead: 'The page a task is building opens beside it, in a browser of its own. Point at what’s wrong; the lead sees what you see, and tries it itself.',
  draw: (tilt) => <BrowserDrawing tilt={tilt} />,
}

export const SMALL: Piece[] = [
  {
    id: 'voice',
    title: (
      <>
        Say it. <b>Don’t type it.</b>
      </>
    ),
    lead: 'Dictate to the coordinator or any task, transcribed on your computer.',
    draw: (tilt) => <VoiceDrawing tilt={tilt} />,
  },
  {
    id: 'queue',
    title: (
      <>
        Merge queues, <b>in order.</b>
      </>
    ),
    lead: 'Stacked changes merge bottom-up, through your host’s merge queue.',
    draw: (tilt) => <QueueDrawing tilt={tilt} />,
  },
  {
    id: 'skills',
    title: (
      <>
        One set of skills. <b>Every agent.</b>
      </>
    ),
    lead: 'Add a skill once; Claude Code, Codex and OpenCode all get it.',
    draw: (tilt) => <SkillsDrawing tilt={tilt} />,
  },
  {
    id: 'servers',
    title: (
      <>
        MCP servers, <b>set up once.</b>
      </>
    ),
    lead: 'Add a server once, and it’s written into every agent’s own config.',
    draw: (tilt) => <ServersDrawing tilt={tilt} />,
  },
  {
    id: 'load',
    title: (
      <>
        Your machine, <b>at a glance.</b>
      </>
    ),
    lead: 'What each task takes of your CPU and memory, live.',
    draw: (tilt) => <LoadDrawing tilt={tilt} />,
  },
  {
    id: 'storage',
    title: (
      <>
        Disk space, <b>looked after.</b>
      </>
    ),
    lead: 'Finished tasks’ folders go when they’re done; anything unpushed stays.',
    draw: (tilt) => <StorageDrawing tilt={tilt} />,
  },
]

/** The rest, as words alone. */
export const MORE = [
  'Drop in any file',
  'Tasks as a graph',
  'Run any branch',
  'Stacked changes',
  'Diagrams in threads',
  'Usage per task',
  'Warm dark mode',
]

/** Every small one, as words alone. */
export const ALL_WORDS = [
  'Voice dictation',
  'Merge queues',
  'Skills in every agent',
  'MCP servers, set up once',
  'Your machine’s load',
  'Disk space, looked after',
  ...MORE,
]
