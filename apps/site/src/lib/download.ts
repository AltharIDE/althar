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
 * The chip matters on a Mac, which has a build for Apple silicon and one for
 * Intel, and every browser's user agent says "Intel" there. Chromium answers
 * `userAgentData.getHighEntropyValues(['architecture'])` honestly (even run
 * under Rosetta it names the Mac's own chip); where nothing answers, as in
 * Safari and Firefox, Apple silicon is assumed, as most Macs now are, and the
 * other build is a link of its own beside it. A release made before the
 * Intel build has none, so an Intel Mac is sent to the releases page.
 */

/** A chip, as `userAgentData` names it; null where the browser doesn't say. */
export type Arch = 'arm' | 'x86' | null

/** A release's file, as GitHub's API lists it. */
export interface Asset {
  name: string
  browser_download_url: string
}

type Chip = Exclude<Arch, null>

/** Each system's installer among a release's files, by the chip it is for, and the chip assumed where the browser doesn't say. Windows is x64, which Windows on ARM runs emulated. */
const BUILDS: Record<Os, { files: Partial<Record<Chip, RegExp>>; assumed: Chip }> = {
  mac: { files: { arm: /-arm64\.dmg$/, x86: /-x64\.dmg$/ }, assumed: 'arm' },
  linux: { files: { x86: /\.AppImage$/ }, assumed: 'x86' },
  windows: { files: { x86: /\.exe$/, arm: /\.exe$/ }, assumed: 'x86' },
}

/** The installer for `os` on `arch` among a release's files, or null where there is none: a system or chip with no build, or none known. */
export function pickAsset(os: Os | null, arch: Arch, assets: readonly Asset[]): Asset | null {
  if (!os) return null
  const build = BUILDS[os]
  const file = build.files[arch ?? build.assumed]
  return (file && assets.find((a) => file.test(a.name))) ?? null
}

/** What a Mac's chip is called, for the link to the other build. */
const CHIP_NAME: Record<Chip, string> = { arm: 'Apple silicon', x86: 'an Intel Mac' }

/** A Mac's other build: the one for the chip the reader's isn't, as far as the browser says. Null off a Mac, or where the release has none. */
export function otherMac(os: Os | null, arch: Arch, assets: readonly Asset[]): (Asset & { chip: Chip }) | null {
  if (os !== 'mac') return null
  const chip: Chip = (arch ?? BUILDS.mac.assumed) === 'arm' ? 'x86' : 'arm'
  const asset = pickAsset('mac', chip, assets)
  return asset && { ...asset, chip }
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
  /** On a Mac, the other chip's build, named. */
  other: { href: string; label: string } | null
}

/** The reader's installer, once the release and the chip are known; null where the link is the releases page. Exported for its tests. */
export async function findDownload(): Promise<Found | null> {
  const os = detectOs()
  if (!os) return null
  // Asked for by hand, the address stands for the whole system, chip included: the build's, not the one under the browser.
  const [assets, arch] = await Promise.all([assetsOnce(), askedOs() ? null : archOnce()])
  const asset = pickAsset(os, arch, assets)
  const other = otherMac(os, arch, assets)
  return (
    asset && {
      os,
      href: asset.browser_download_url,
      other: other && { href: other.browser_download_url, label: `Or for ${CHIP_NAME[other.chip]}` },
    }
  )
}

/**
 * The download link: the latest release's installer for the reader's
 * system (`os`), or the releases page with `os` null. `pending` is true
 * until the answer is in, and in the prerender. The label names the system
 * only where the link is its installer. On a Mac, `other` is the other chip's
 * build: until the answer is in it is Intel's, on the releases page, so its
 * line is there from the start.
 */
export function useDownload() {
  const [found, setFound] = useState<Found | null>()
  useEffect(() => {
    let live = true
    void findDownload().then((it) => {
      if (live) setFound(it)
    })
    return () => {
      live = false
    }
  }, [])
  const os = found?.os ?? null
  const pending = found === undefined
  return {
    os,
    href: found?.href ?? LINKS.releases,
    label: os ? `Download for ${OS_NAME[os]}` : 'Download',
    other: pending ? { href: LINKS.releases, label: `Or for ${CHIP_NAME.x86}` } : (found?.other ?? null),
    pending,
  }
}
