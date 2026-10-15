import { useEffect, useState } from 'react'

import { LATEST_RELEASE, LINKS } from '../content/facts'
import { askedOs, detectOs, type Os, OS_NAME } from '../shared/OsMark'

/*
 * The download for the system the page is read on: the latest published
 * release's installer, found from GitHub's API once per page, or the latest
 * release's page wherever that can't be done: the system is a phone or
 * unknown, there is no build for it or its chip, or the API doesn't answer
 * (down, or rate-limited). The link is never broken: until the answer is in,
 * and in the prerender, it is the latest release's page. Where the release
 * answered and has nothing for the reader's system or chip, the hook says so
 * in a plain sentence (`missing`), naming what the release does have.
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

/** The systems, in the order the site names them. */
const SYSTEMS: readonly Os[] = ['mac', 'linux', 'windows']

/** Each system's chips, as people call them. */
const CHIP_NAME: Record<Os, Record<Exclude<Arch, null>, string>> = {
  mac: { arm: 'Apple silicon', x86: 'Intel Macs' },
  linux: { arm: 'Linux on ARM', x86: 'x64 Linux' },
  windows: { arm: 'Windows on ARM', x86: 'x64 Windows' },
}

/** Names as a sentence lists them: "a", "a and b", "a, b and c". */
const listed = (names: readonly string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '')

/**
 * What to tell a reader whose system or chip the release has no build for,
 * naming what it does have: never a date, only what can be downloaded.
 * Exported for its tests.
 */
export function noBuild(os: Os, arch: Arch, assets: readonly Asset[]): string {
  const has = (o: Os) => assets.some((a) => BUILDS[o].file.test(a.name))
  if (has(os) && arch)
    return `No build for ${CHIP_NAME[os][arch]} yet. The ${OS_NAME[os]} build is for ${listed(BUILDS[os].chips.map((c) => CHIP_NAME[os][c]))}.`
  const others = listed(SYSTEMS.filter((o) => o !== os && has(o)).map((o) => OS_NAME[o]))
  return others ? `No ${OS_NAME[os]} build yet. The latest release is for ${others}.` : `No ${OS_NAME[os]} build yet.`
}

/** The reader's system, with its installer, or what to say where the latest release has none. */
interface Found {
  os: Os
  href: string | null
  missing: string | null
}

/**
 * The reader's installer, once the release and the chip are known; or, where
 * a release answered with nothing for this system or chip, the sentence that
 * says so. Null where the system is unknown or no release answered. Exported
 * for its tests.
 */
export async function findDownload(): Promise<Found | null> {
  const os = detectOs()
  if (!os) return null
  // Asked for by hand, the address stands for the whole system, chip included: the build's, not the one under the browser.
  const [assets, arch] = await Promise.all([assetsOnce(), askedOs() ? null : archOnce()])
  if (assets.length === 0) return null
  const asset = pickAsset(os, arch, assets)
  return asset ? { os, href: asset.browser_download_url, missing: null } : { os, href: null, missing: noBuild(os, arch, assets) }
}

/**
 * The download link: the latest release's installer for the reader's
 * system (`os`), or the latest release's page with `os` null. `pending` is
 * true until the answer is in, and in the prerender. The label names the
 * system only where the link is its installer. `missing` says plainly when
 * the release has no build for this system or chip.
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
  const href = found?.href ?? null
  const os = href === null ? null : (found?.os ?? null)
  return {
    os,
    href: href ?? LINKS.latest,
    label: os ? `Download for ${OS_NAME[os]}` : 'Download',
    pending: found === undefined,
    missing: found?.missing ?? null,
  }
}
