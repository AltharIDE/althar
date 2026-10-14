import { useEffect, useState } from 'react'

import { LATEST_RELEASE, LINKS } from '../content/facts'
import { detectOs, type Os, OS_NAME } from '../shared/OsMark'

/*
 * The download for the system the page is read on: the latest published
 * release's installer, found from GitHub's API once per page, or the
 * releases page wherever that can't be done: the system is a phone or
 * unknown, there is no build for it or its chip, or the API doesn't answer
 * (down, or rate-limited). The link is never broken: until the answer is in,
 * and in the prerender, it is the releases page, as it was.
 *
 * The chip matters on a Mac: the build is Apple silicon only, and every
 * browser's user agent says "Intel" there. Chromium answers
 * `userAgentData.getHighEntropyValues(['architecture'])` honestly; where
 * nothing answers, the one build the system has is assumed.
 */

/** A chip, as `userAgentData` names it; null where the browser doesn't say. */
export type Arch = 'arm' | 'x86' | null

/** A release's file, as GitHub's API lists it. */
export interface Asset {
  name: string
  browser_download_url: string
}

/** Each system's installer among a release's files, and the chips it runs on. Windows is x64 when it comes, which Windows on ARM runs emulated. */
const BUILDS: Record<Os, { file: RegExp; chips: readonly Exclude<Arch, null>[] }> = {
  mac: { file: /\.dmg$/, chips: ['arm'] },
  linux: { file: /\.AppImage$/, chips: ['x86'] },
  windows: { file: /\.exe$/, chips: ['x86', 'arm'] },
}

/** The installer for `os` on `arch` among a release's files, or null where there is none: a system or chip with no build, or none known. */
export function pickAsset(os: Os | null, arch: Arch, assets: readonly Asset[]): Asset | null {
  if (!os) return null
  const build = BUILDS[os]
  if (arch && !build.chips.includes(arch)) return null
  return assets.find((a) => build.file.test(a.name)) ?? null
}

let release: Promise<Asset[]> | undefined

/** The latest published release's files, fetched once per page; none where the API doesn't answer. */
const assetsOnce = () =>
  (release ??= fetch(LATEST_RELEASE)
    .then(async (r) => (r.ok ? (((await r.json()) as { assets?: Asset[] }).assets ?? []) : []))
    .catch((): Asset[] => []))

/** What Chromium calls `navigator.userAgentData`; other browsers have none. */
interface UaData {
  getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>
}

let chip: Promise<Arch> | undefined

/** The chip, where the browser says; asked once per page. */
const archOnce = () =>
  (chip ??= (async () => {
    const data = (navigator as Navigator & { userAgentData?: UaData }).userAgentData
    if (!data) return null
    const { architecture } = await data.getHighEntropyValues(['architecture'])
    return architecture === 'arm' || architecture === 'x86' ? architecture : null
  })().catch((): Arch => null))

interface Found {
  os: Os
  href: string
}

/**
 * The download link: the latest release's installer for the reader's
 * system (`os`), or the releases page with `os` null. `pending` is true
 * until the answer is in, and in the prerender. The label names the system
 * only where the link is its installer.
 */
export function useDownload() {
  const [found, setFound] = useState<Found | null>()
  useEffect(() => {
    let live = true
    const os = detectOs()
    if (!os) {
      setFound(null)
      return
    }
    void Promise.all([assetsOnce(), archOnce()]).then(([assets, arch]) => {
      if (!live) return
      const asset = pickAsset(os, arch, assets)
      setFound(asset && { os, href: asset.browser_download_url })
    })
    return () => {
      live = false
    }
  }, [])
  const os = found?.os ?? null
  return {
    os,
    href: found?.href ?? LINKS.releases,
    label: os ? `Download for ${OS_NAME[os]}` : 'Download',
    pending: found === undefined,
  }
}
