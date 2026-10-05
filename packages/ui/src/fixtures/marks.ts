import { ProjectInk } from '../foundations/ProjectMark/drawing'

/* The projects on this Mac (chrome.ts), each with the ink its mark is drawn
   in and what is going on in it, as a list of projects would show them. */
export interface MarkedProject {
  id: string
  name: string
  ink: ProjectInk
  running: boolean
  yours: boolean
}

export const MARKED: MarkedProject[] = [
  { id: 'meridian', name: 'Meridian', ink: ProjectInk.Teal, running: true, yours: true },
  { id: 'halyard', name: 'Halyard', ink: ProjectInk.Clay, running: true, yours: false },
  { id: 'tessera', name: 'Tessera', ink: ProjectInk.Moss, running: false, yours: true },
  { id: 'ferrous', name: 'Ferrous', ink: ProjectInk.Ochre, running: false, yours: false },
]

/* Names a person might give their repositories, to show what the generator draws. */
export const SEEDS: readonly string[] = [
  'althar',
  'erza',
  'meridian-api',
  'dotfiles',
  'tastemakers-site',
  'billing-web',
  'ledger',
  'infra',
  'mobile',
  'design-system',
  'search',
  'notifications',
  'docs',
  'ingest',
  'auth',
  'analytics',
]
