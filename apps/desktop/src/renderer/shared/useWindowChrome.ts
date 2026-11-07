import type { TitleBarWindow, WindowControls } from '@althar/ui'
import { useEffect, useState } from 'react'

import type { DesktopChrome } from '../../main/desktop'
import { type Host, useServices } from '../data/services'

/*
 * What a screen's bar needs of the window's own buttons, as the desktop the
 * window sits on has them (main/desktop.ts, ADR-098): on macOS the system
 * draws its traffic lights and only their room is kept; where the window
 * manager draws the window's frame, or a tiling compositor has none, the bar
 * draws none; elsewhere it draws them in that desktop's manner, in its order
 * and at its end, wired to the host, and says maximize or restore by
 * whether the window is maximized.
 */

export interface WindowChrome {
  readonly lights: 'space' | 'drawn' | 'none'
  readonly window?: TitleBarWindow
  readonly controls?: WindowControls
}

/** Whether the window is maximized, read once and kept current as the window changes. */
export const useMaximized = (host: Pick<Host, 'maximized' | 'onMaximized'>): boolean => {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    let live = true
    void host
      .maximized()
      .then((now) => {
        if (live) setMaximized(now)
      })
      .catch(() => undefined)
    const off = host.onMaximized(setMaximized)
    return () => {
      live = false
      off()
    }
  }, [host])
  return maximized
}

/** What the desktop says, as main handed it to the window and as it changes; nothing where main said nothing. */
export const useDesktopChrome = (host: Pick<Host, 'chrome' | 'onChrome'>): DesktopChrome | undefined => {
  const [chrome, setChrome] = useState(() => host.chrome?.())
  useEffect(() => host.onChrome?.(setChrome), [host])
  return chrome
}

/**
 * The bar's buttons for what the desktop says. Where main said nothing (a page that wasn't handed it), Windows still has its
 * caption buttons and Linux the neutral ones, all three at the end.
 */
export const controlsFor = (platform: string, chrome: DesktopChrome | undefined): Pick<WindowChrome, 'lights' | 'controls'> => {
  if (platform === 'darwin' || chrome?.kind === 'mac') return { lights: 'space' }
  if (chrome === undefined) {
    const end = ['minimize', 'maximize', 'close'] as const
    return platform === 'win32'
      ? { lights: 'drawn', controls: { look: 'windows', start: [], end } }
      : { lights: 'drawn', controls: { look: 'gnome', tone: 'legacy', start: [], end } }
  }
  if (chrome.kind !== 'drawn' || chrome.look === undefined) return { lights: 'none' }
  return {
    lights: 'drawn',
    controls: {
      look: chrome.look,
      ...(chrome.tone === undefined ? {} : { tone: chrome.tone }),
      start: chrome.layout.start,
      end: chrome.layout.end,
    },
  }
}

/** The bar's buttons for a host's window, wired to it: for a screen shown before the window's services are, given the host itself. */
export const useHostChrome = (
  host: Pick<Host, 'platform' | 'chrome' | 'onChrome' | 'window' | 'maximized' | 'onMaximized'>,
): WindowChrome => {
  const maximized = useMaximized(host)
  const chrome = useDesktopChrome(host)
  const { lights, controls } = controlsFor(host.platform, chrome)
  if (lights !== 'drawn') return { lights }
  return {
    lights,
    ...(controls === undefined ? {} : { controls }),
    window: {
      onClose: () => host.window('close'),
      onMinimize: () => host.window('minimize'),
      onToggleMaximize: () => host.window('toggle-maximize'),
      maximized,
    },
  }
}

export const useWindowChrome = (): WindowChrome => useHostChrome(useServices().host)
