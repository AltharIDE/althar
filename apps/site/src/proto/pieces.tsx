import type { ReactNode } from 'react'

import {
  BrowserDrawing,
  CanvasDrawing,
  DropDrawing,
  LoadDrawing,
  QueueDrawing,
  ServersDrawing,
  SkillsDrawing,
  StorageDrawing,
  VoiceDrawing,
} from './drawn'

/*
 * The features under the console, smaller than its own: their claim, a line
 * each, and their drawing (drawn.tsx). Then the rest, as words alone.
 */

export interface Piece {
  id: string
  title: ReactNode
  lead: string
  draw: () => ReactNode
}

const CANVAS: Piece = {
  id: 'canvas',
  title: (
    <>
      It draws it out. <b>You mark it up.</b>
    </>
  ),
  lead: 'Leads draw pages and diagrams on the canvas; comment, and the next version answers.',
  draw: () => <CanvasDrawing size="mid" />,
}

const BROWSER: Piece = {
  id: 'browser',
  title: (
    <>
      See it running. <b>Point at what’s off.</b>
    </>
  ),
  lead: 'The page a task is building, open beside it. Point at what’s wrong, and the lead tries it.',
  draw: () => <BrowserDrawing size="mid" />,
}

const VOICE: Piece = {
  id: 'voice',
  title: (
    <>
      Say it. <b>Don’t type it.</b>
    </>
  ),
  lead: 'Dictate to the coordinator or any task, transcribed on your computer.',
  draw: () => <VoiceDrawing />,
}

const QUEUE: Piece = {
  id: 'queue',
  title: (
    <>
      Merge queues, <b>in order.</b>
    </>
  ),
  lead: 'Stacked changes merge bottom-up, through your host’s merge queue.',
  draw: () => <QueueDrawing />,
}

const SKILLS: Piece = {
  id: 'skills',
  title: (
    <>
      One set of skills. <b>Every agent.</b>
    </>
  ),
  lead: 'Add a skill once; Claude Code, Codex and OpenCode all get it.',
  draw: () => <SkillsDrawing />,
}

const SERVERS: Piece = {
  id: 'servers',
  title: (
    <>
      MCP servers, <b>set up once.</b>
    </>
  ),
  lead: 'Add a server once, and it’s written into every agent’s own config.',
  draw: () => <ServersDrawing />,
}

const LOAD: Piece = {
  id: 'load',
  title: (
    <>
      Your machine, <b>at a glance.</b>
    </>
  ),
  lead: 'What each task takes of your CPU and memory, live.',
  draw: () => <LoadDrawing />,
}

const STORAGE: Piece = {
  id: 'storage',
  title: (
    <>
      Disk space, <b>looked after.</b>
    </>
  ),
  lead: 'Finished tasks’ folders go when they’re done; anything unpushed stays.',
  draw: () => <StorageDrawing />,
}

const DROP: Piece = {
  id: 'drop',
  title: (
    <>
      Drop in <b>anything.</b>
    </>
  ),
  lead: 'PDFs, logs, zips, whole folders: drop them in, and the lead reads them.',
  draw: () => <DropDrawing />,
}

/** Eight: the canvas and the browser first, then the rest. */
export const EIGHT: Piece[] = [CANVAS, BROWSER, VOICE, QUEUE, SKILLS, SERVERS, LOAD, STORAGE]
/** Nine, for three rows of three. */
export const NINE: Piece[] = [CANVAS, BROWSER, DROP, VOICE, QUEUE, SKILLS, SERVERS, LOAD, STORAGE]

/** What isn't drawn, as words alone. */
const REST = [
  'Tasks as a graph',
  'Run any branch',
  'Work in your own checkout',
  'Leads update your issues',
  'Diagrams in threads',
  'Usage per task',
  'Warm dark mode',
]
export const ALSO_EIGHT = ['Drop in any file', ...REST]
export const ALSO_NINE = REST
