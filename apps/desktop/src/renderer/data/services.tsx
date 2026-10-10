import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect, useEffectEvent } from 'react'

import type { WatchEvent } from '@althar/contracts'

import type { AppPreferences, PreferenceKey } from '../../main/appPreferences'

import type { Client } from './client'
import type { Feed } from './feed'

/*
 * What the view models reach through React: the runtime's client, the
 * window's cache of what it read and its watch on what changes, and the few
 * things only the host can do, such as opening the folder picker. Tests give
 * fakes of the client and the host.
 */

/** Where dictation stands, as the main process reads it. */
export interface DictationState {
  /** The system it runs on, for the words that name its settings. */
  readonly platform: string
  /** Whether the system lets Althar use the microphone: yes, it would ask first (macOS, once), or it said no. */
  readonly microphone: 'granted' | 'ask' | 'denied'
  /** The speech model: all here and checked, or how much of it is, in bytes; and whether it is coming down now. */
  readonly model: { readonly ready: boolean; readonly got: number; readonly size: number; readonly downloading: boolean }
  /** Whether the system has settings Althar can open (macOS and Windows). */
  readonly settings: boolean
}

/** Why the model's download stopped short. */
export type DownloadStop =
  | { readonly reason: 'network' }
  | { readonly reason: 'corrupt' }
  | { readonly reason: 'space'; readonly need: number; readonly free: number }

/** How the model's download goes, as every window hears it. */
export type DictationEvent =
  | { readonly type: 'progress'; readonly got: number; readonly size: number }
  | { readonly type: 'downloaded' }
  | { readonly type: 'stopped'; readonly stop: DownloadStop; readonly got: number; readonly size: number }
  | { readonly type: 'cancelled' }

/** Dictation, through the main process: the microphone's permission, the speech model, and writing down what was said (ADR-017). */
export interface DictationHost {
  readonly state: () => Promise<DictationState>
  /** Asks the system for the microphone where it asks; whether it may be used. */
  readonly allow: () => Promise<boolean>
  /** Starts bringing the model down, or carries on from where it stopped. How it goes comes as events. */
  readonly download: () => Promise<void>
  /** Stops the download and keeps nothing of it. */
  readonly cancel: () => Promise<void>
  /** Loads the model, so the first words are written down without the wait. */
  readonly prepare: () => Promise<void>
  /** What was said, as text: 16 kHz mono samples, or whatever rate they were recorded at. */
  readonly transcribe: (samples: Float32Array, sampleRate: number) => Promise<string>
  /** Opens the system's microphone privacy or sound settings; false where there are none to open. */
  readonly openSettings: (pane: 'privacy' | 'sound') => Promise<boolean>
  readonly onEvent: (listener: (event: unknown) => void) => () => void
}

/**
 * What only the app's main process can do. The window never handles a path:
 * the main process shows the picker, or is told what was dropped, and hands
 * back a grant the runtime knows the folder by.
 */
/** The repositories found on this computer, as main reads them: each by an id it grants by, never by its path. */
export interface FoundRepositories {
  /** The places looked in, as the person knows them: ~/Projects. */
  readonly lookedIn: ReadonlyArray<string>
  readonly repositories: ReadonlyArray<{
    readonly id: string
    readonly name: string
    /** Where it is, as the person knows the place: ~/Projects/meridian. */
    readonly where: string
    readonly branch: string | null
    /** When it was last worked on, in ms since the epoch. */
    readonly worked: number
  }>
}

export interface Host {
  /** The system Althar runs on: darwin, win32, linux. */
  readonly platform: string
  /** Asks the person for a folder, for a project or an agent's account; its grant, or null when they cancel. */
  readonly pickFolder: (purpose?: 'project' | 'account') => Promise<string | null>
  /** A grant for a folder dropped on the window; null when it isn't a folder on disk. */
  readonly grantDropped: (file: File) => Promise<string | null>
  /** The git repositories where people usually keep code on this computer, newest work first, and where it looked. */
  readonly findRepositories: () => Promise<FoundRepositories>
  /** A grant for a repository it found, by its id; null for one it didn't. */
  readonly grantFound: (id: string) => Promise<string | null>
  /** The icon the person gave the app, by name (see `shared/appIcons`), or null where there is no Dock to show one. */
  readonly appIcon: () => Promise<string | null>
  /** Gives the app another icon, kept and shown on the Dock at once. */
  readonly setAppIcon: (icon: string) => Promise<void>
  /** The app's own preferences (`main/appPreferences`), as the main process keeps them. */
  readonly preferences: () => Promise<AppPreferences>
  /** Changes one, kept and acted on at once; all of them as they now stand. */
  readonly setPreference: <K extends PreferenceKey>(key: K, value: AppPreferences[K]) => Promise<AppPreferences>
  /** An editor's icon as a picture's address, by its id (`ListEditors`); null where it can't be drawn. */
  readonly editorPicture: (id: string) => Promise<string | null>
  /** The Mac's alert sounds a notification can play, by name; none off a Mac. */
  readonly sounds: () => Promise<ReadonlyArray<string>>
  /** Plays one of them once, so the person hears it. */
  readonly playSound: (name: string) => Promise<void>
  /** Calls `listener` with the thread a notification the person clicked is about, until the returned function is called. */
  readonly onOpen: (listener: (threadId: string) => void) => () => void
  /** Where Althar shows while the person is in another app (`shared/edge`), and whether this Mac has a notch to choose the island by; null before the main process knows. */
  readonly edge: () => Promise<{ readonly place: string; readonly notch: boolean } | null>
  /** Shows it there instead, and keeps the choice. */
  readonly setEdge: (place: string) => Promise<void>
  /** From the island: where it draws in its page, so the main process can tell when the pointer is on it. */
  readonly edgeDrawn: (rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }) => void
  /** For the island: calls `listener` as the pointer comes onto it or leaves, until the returned function is called. */
  readonly onEdgePointed: (listener: (on: boolean) => void) => () => void
  /** From the menu bar's sheet: how tall it draws. */
  readonly edgeSize: (height: number) => void
  /** From the edge: brings Althar's window forward, on a thread, or as it was. */
  readonly openInWindow: (threadId?: string) => void
  /** Dictation; absent where a page can't dictate. */
  readonly dictation?: DictationHost
}

export interface Services {
  readonly client: Client
  readonly host: Host
  /** What the window has read, by key (`reads.ts`). */
  readonly cache: QueryClient
  readonly feed: Feed
}

const ServicesContext = createContext<Services | null>(null)

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return (
    <ServicesContext.Provider value={value}>
      <QueryClientProvider client={value.cache}>{children}</QueryClientProvider>
    </ServicesContext.Provider>
  )
}

export const useServices = (): Services => {
  const services = useContext(ServicesContext)
  if (services === null) throw new Error('useServices needs a ServicesProvider')
  return services
}

/** Calls `listener` with every change the window hears while the component is mounted. */
export const useWatch = (listener: (event: WatchEvent) => void) => {
  const { feed } = useServices()
  const onEvent = useEffectEvent(listener)
  useEffect(() => feed.listen((event) => onEvent(event)), [feed])
}
