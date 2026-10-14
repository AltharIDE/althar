import { useEffect, useState } from 'react'

import { LATEST_RELEASE, LINKS } from '../content/facts'
import { askedOs, detectOs, type Os, OS_NAME } from '../shared/OsMark'

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

/** The reader's installer, once the release and the chip are known; null where the link is the releases page. */
async function find(): Promise<Found | null> {
  const os = detectOs()
  if (!os) return null
  // Asked for by hand, the address stands for the whole system, chip included: the build's, not the one under the browser.
  const [assets, arch] = await Promise.all([assetsOnce(), askedOs() ? null : archOnce()])
  const asset = pickAsset(os, arch, assets)
  return asset && { os, href: asset.browser_download_url }
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
    void find().then((it) => {
      if (live) setFound(it)
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
