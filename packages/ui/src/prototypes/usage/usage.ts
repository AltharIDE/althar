import type { Brand } from '../../foundations/brands/brands'

/*
 * What a readout of this Mac's load is given: the machine as a whole, the
 * part of it Althar's agents use, and each running task's share. It all
 * arrives measured and formatted; a readout only draws it. A prototype:
 * nothing reads real numbers yet, and nothing outside src/prototypes
 * imports this. Compare.mdx says how the numbers could be read later.
 */

/** How hard macOS is working to find memory, in its own three levels. The honest sign that memory is short: a Mac keeps memory full of cache on purpose. */
export enum MemoryPressure {
  Normal = 'normal',
  Warning = 'warning',
  Critical = 'critical',
}

/** How warm the Mac is, as macOS reports it (Electron's powerMonitor). From Serious, it slows itself down to cool. */
export enum ThermalState {
  Nominal = 'nominal',
  Fair = 'fair',
  Serious = 'serious',
  Critical = 'critical',
}

/** What holds the Mac back, if anything: said in a word, never in a colour. */
export enum Strain {
  Heat = 'heat',
  MemoryShort = 'memory-short',
  MemoryTight = 'memory-tight',
  CpuFull = 'cpu-full',
}

/** The load in three steps, for a glyph that changes rarely. */
export enum Load {
  Quiet = 'quiet',
  Busy = 'busy',
  Full = 'full',
}

/** One running task's share of the Mac: its agents and everything they started. */
export interface UsageShare {
  id: string
  /** The task, as the board names it. */
  title: string
  /** The project it belongs to; the Mac is shared by every project's work. */
  project: string
  /** The agent leading it: Claude Code. */
  agent: string
  mark?: Brand
  /** Its share of all the CPU, 0 to 1. */
  cpu: number
  /** The memory it holds, formatted: 1.8 GB. */
  memory: string
  /** How many processes it has, its agents and what they started. */
  processes: number
}

/** A moment of CPU, 0 to 1: the whole Mac, and the part of it Althar's agents used. */
export interface UsagePoint {
  cpu: number
  althar: number
}

export interface Usage {
  /** All the CPU in use, 0 to 1, across every core. */
  cpu: number
  /** The part of `cpu` that Althar's agents and what they started use. */
  althar: number
  /** Memory in use, 0 to 1, as Activity Monitor counts it: without what macOS keeps as cache. */
  memory: number
  /** The part of `memory` Althar's agents hold. */
  altharMemory: number
  /** Memory in use, formatted: 21.4 GB. */
  memoryUsed: string
  /** All the memory, formatted: 32 GB. */
  memoryTotal: string
  pressure: MemoryPressure
  thermal: ThermalState
  /** The running tasks, most first. Empty when nothing runs. */
  shares: readonly UsageShare[]
  /** CPU over the last minutes, oldest first. */
  history: readonly UsagePoint[]
}

/** From here the CPU counts as full; from BUSY, as busy. */
const FULL = 0.9
const BUSY = 0.45

/** The one strain worth saying, the worst first: heat slows everything, then memory, then a full CPU. */
export function strainOf(u: Pick<Usage, 'cpu' | 'pressure' | 'thermal'>): Strain | null {
  if (u.thermal === ThermalState.Serious || u.thermal === ThermalState.Critical) return Strain.Heat
  if (u.pressure === MemoryPressure.Critical) return Strain.MemoryShort
  if (u.pressure === MemoryPressure.Warning) return Strain.MemoryTight
  if (u.cpu >= FULL) return Strain.CpuFull
  return null
}

export function loadOf(u: Pick<Usage, 'cpu' | 'pressure' | 'thermal'>): Load {
  if (strainOf(u) !== null) return Load.Full
  return u.cpu >= BUSY ? Load.Busy : Load.Quiet
}

/** A share, 0 to 1, as a whole percent. */
export const percent = (share: number) => Math.round(Math.min(1, Math.max(0, share)) * 100)

/** How many of `of` steps a share lights: a meter in steps only changes when the load really does. */
export const steps = (share: number, of: number) => Math.round(Math.min(1, Math.max(0, share)) * of)

/*
 * The words every direction shares, once, so a strain reads the same
 * wherever it shows. Each readout takes them in its own `text`.
 */
export interface UsageWords {
  strain: Record<Strain, string>
  /** A strain said in full, for the detail. */
  strainNote: Record<Strain, string>
  load: Record<Load, string>
  pressure: Record<MemoryPressure, string>
  thermal: Record<ThermalState, string>
}

export const usageWords: UsageWords = {
  strain: {
    [Strain.Heat]: 'Slowed by heat',
    [Strain.MemoryShort]: 'Memory is short',
    [Strain.MemoryTight]: 'Memory is tight',
    [Strain.CpuFull]: 'CPU is full',
  },
  strainNote: {
    [Strain.Heat]: 'The Mac is slowing itself down to cool. Work runs slower until it does.',
    [Strain.MemoryShort]: 'macOS is moving memory to disk. Everything, agents included, runs slower.',
    [Strain.MemoryTight]: 'macOS is compressing memory to make room. A little more and it starts using the disk.',
    [Strain.CpuFull]: 'Every core is busy. Work queues behind work, so each task takes longer.',
  },
  load: { [Load.Quiet]: 'Quiet', [Load.Busy]: 'Busy', [Load.Full]: 'Full' },
  pressure: {
    [MemoryPressure.Normal]: 'Memory pressure normal',
    [MemoryPressure.Warning]: 'Memory pressure high',
    [MemoryPressure.Critical]: 'Memory pressure critical',
  },
  thermal: {
    [ThermalState.Nominal]: 'Cool',
    [ThermalState.Fair]: 'Warm',
    [ThermalState.Serious]: 'Hot, slowing down',
    [ThermalState.Critical]: 'Too hot, slowing down hard',
  },
}
