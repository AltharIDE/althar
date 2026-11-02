import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { type Asset, otherMac, pickAsset } from '../src/lib/download'

/*
 * Which of a release's files a system gets: the files as the release
 * workflow names them (.github/workflows/release.yml), with and without the
 * Windows installer, which the earlier releases don't have. Then the lookup as a browser runs
 * it, with the user agent, the chip and GitHub's API stubbed: the module is
 * loaded fresh each time, since it asks the API once for the page.
 */

const RELEASE = 'https://github.com/AltharIDE/althar/releases/download/v0.2.0'
const url = (name: string) => `${RELEASE}/${name}`
const file = (name: string): Asset => ({ name, browser_download_url: url(name) })

const SHIPPED = [
  'Althar-0.2.0-arm64-mac.zip',
  'Althar-0.2.0-arm64-mac.zip.blockmap',
  'Althar-0.2.0-arm64.dmg',
  'Althar-0.2.0-arm64.dmg.blockmap',
  'Althar-0.2.0.AppImage',
  'althar-0.2.0.x86_64.rpm',
  'althar_0.2.0_amd64.deb',
  'latest-linux.yml',
  'latest-mac.yml',
].map(file)

const WITH_WINDOWS = [...SHIPPED, file('Althar-0.2.0-x64-setup.exe'), file('Althar-0.2.0-x64-setup.exe.blockmap'), file('latest.yml')]

/** A release with Intel's Mac build beside Apple silicon's, and the Windows installer, also x64. */
const WITH_INTEL = [
  ...WITH_WINDOWS,
  ...['Althar-0.2.0-x64-mac.zip', 'Althar-0.2.0-x64-mac.zip.blockmap', 'Althar-0.2.0-x64.dmg', 'Althar-0.2.0-x64.dmg.blockmap'].map(file),
]

describe('pickAsset', () => {
  it('gives a Mac the dmg, not the zip or its blockmap', () => {
    expect(pickAsset('mac', null, SHIPPED)?.name).toBe('Althar-0.2.0-arm64.dmg')
    expect(pickAsset('mac', 'arm', SHIPPED)?.browser_download_url).toBe(url('Althar-0.2.0-arm64.dmg'))
  })

  it('gives Linux the AppImage, not the deb or rpm', () => {
    expect(pickAsset('linux', null, SHIPPED)?.name).toBe('Althar-0.2.0.AppImage')
    expect(pickAsset('linux', 'x86', SHIPPED)?.name).toBe('Althar-0.2.0.AppImage')
  })

  it('gives Windows the installer once a release has one, not its blockmap or feed', () => {
    expect(pickAsset('windows', null, WITH_WINDOWS)?.name).toBe('Althar-0.2.0-x64-setup.exe')
    expect(pickAsset('windows', 'x86', WITH_WINDOWS)?.name).toBe('Althar-0.2.0-x64-setup.exe')
    // Windows on ARM runs the x64 build emulated.
    expect(pickAsset('windows', 'arm', WITH_WINDOWS)?.name).toBe('Althar-0.2.0-x64-setup.exe')
  })

  it('gives Windows nothing while no release has an exe', () => {
    expect(pickAsset('windows', null, SHIPPED)).toBeNull()
    expect(pickAsset('windows', 'x86', SHIPPED)).toBeNull()
  })

  it('gives an unknown system nothing', () => {
    expect(pickAsset(null, null, SHIPPED)).toBeNull()
    expect(pickAsset(null, 'arm', WITH_WINDOWS)).toBeNull()
  })

  it('gives an Intel Mac Intel’s dmg once a release has one, and Apple silicon or an unsaid chip Apple silicon’s', () => {
    expect(pickAsset('mac', 'x86', WITH_INTEL)?.name).toBe('Althar-0.2.0-x64.dmg')
    expect(pickAsset('mac', 'arm', WITH_INTEL)?.name).toBe('Althar-0.2.0-arm64.dmg')
    expect(pickAsset('mac', null, WITH_INTEL)?.name).toBe('Althar-0.2.0-arm64.dmg')
    // Not the Windows installer, though it is x64 too.
    expect(pickAsset('windows', 'x86', WITH_INTEL)?.name).toBe('Althar-0.2.0-x64-setup.exe')
  })

  it('offers a Mac the other chip’s build, where the release has it', () => {
    expect(otherMac('mac', null, WITH_INTEL)).toMatchObject({ name: 'Althar-0.2.0-x64.dmg', chip: 'x86' })
    expect(otherMac('mac', 'arm', WITH_INTEL)).toMatchObject({ name: 'Althar-0.2.0-x64.dmg', chip: 'x86' })
    expect(otherMac('mac', 'x86', WITH_INTEL)).toMatchObject({ name: 'Althar-0.2.0-arm64.dmg', chip: 'arm' })
    expect(otherMac('mac', null, SHIPPED)).toBeNull()
    expect(otherMac('windows', 'x86', WITH_INTEL)).toBeNull()
    expect(otherMac(null, null, WITH_INTEL)).toBeNull()
  })

  it('gives a chip with no build nothing: an Intel Mac before Intel’s build, an ARM Linux', () => {
    expect(pickAsset('mac', 'x86', SHIPPED)).toBeNull()
    expect(pickAsset('linux', 'arm', SHIPPED)).toBeNull()
  })

  it('gives nothing from a release with no files', () => {
    expect(pickAsset('mac', 'arm', [])).toBeNull()
    expect(pickAsset('linux', null, [])).toBeNull()
  })
})

/* User agents as browsers send them. Safari on an iPad asking for desktop sites, its default, says it is a Mac. */
const UA = {
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  ipadMobile:
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  odd: 'curl/8.4.0',
}

interface Browser {
  ua: string
  /** Chromium says its chip through userAgentData; the others have none. */
  arch?: 'arm' | 'x86'
  touches?: number
  search?: string
}

/** A browser's window and navigator, as the lookup reads them. */
function browse({ ua, arch, touches = 0, search = '' }: Browser) {
  const userAgentData = arch && { getHighEntropyValues: () => Promise.resolve({ architecture: arch, bitness: '64' }) }
  vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints: touches, userAgentData })
  vi.stubGlobal('window', { location: { search } })
}

/** GitHub's API, answering the latest release with `assets`; or a status with no release; or no answer at all. */
function api(answer: { assets: Asset[] } | number | Error) {
  const fetch = vi.fn(() => {
    if (answer instanceof Error) return Promise.reject(answer)
    if (typeof answer === 'number') return Promise.resolve(new Response('{"message":"no"}', { status: answer }))
    return Promise.resolve(new Response(JSON.stringify({ tag_name: 'v0.2.0', ...answer }), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** The lookup, loaded fresh so it asks the API again. */
const lookup = async () => {
  vi.resetModules()
  return (await import('../src/lib/download')).findDownload
}

describe('detectOs', () => {
  afterEach(() => vi.unstubAllGlobals())
  const detect = async () => {
    vi.resetModules()
    return (await import('../src/shared/OsMark')).detectOs()
  }

  it('reads a Mac, Windows and Linux from the user agent', async () => {
    browse({ ua: UA.macSafari })
    expect(await detect()).toBe('mac')
    browse({ ua: UA.windows })
    expect(await detect()).toBe('windows')
    browse({ ua: UA.linux })
    expect(await detect()).toBe('linux')
  })

  it('says nothing for a phone, a tablet or something odd', async () => {
    browse({ ua: UA.iphone, touches: 5 })
    expect(await detect()).toBeNull()
    browse({ ua: UA.android, touches: 5 })
    expect(await detect()).toBeNull()
    browse({ ua: UA.ipadMobile, touches: 5 })
    expect(await detect()).toBeNull()
    browse({ ua: UA.odd })
    expect(await detect()).toBeNull()
  })

  it('tells an iPad asking for desktop sites from a Mac by its touch points', async () => {
    browse({ ua: UA.ipadDesktop, touches: 5 })
    expect(await detect()).toBeNull()
    browse({ ua: UA.macSafari, touches: 0 })
    expect(await detect()).toBe('mac')
  })

  it('takes ?platform= over the user agent', async () => {
    browse({ ua: UA.macSafari, search: '?platform=linux' })
    expect(await detect()).toBe('linux')
    browse({ ua: UA.iphone, touches: 5, search: '?platform=windows' })
    expect(await detect()).toBe('windows')
    browse({ ua: UA.macSafari, search: '?platform=amiga' })
    expect(await detect()).toBe('mac')
  })
})

describe('findDownload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('gives a Mac the dmg, where the browser says nothing of the chip or says Apple silicon', async () => {
    browse({ ua: UA.macSafari })
    api({ assets: SHIPPED })
    expect(await (await lookup())()).toEqual({ os: 'mac', href: url('Althar-0.2.0-arm64.dmg'), other: null })
    browse({ ua: UA.macChrome, arch: 'arm' })
    expect(await (await lookup())()).toEqual({ os: 'mac', href: url('Althar-0.2.0-arm64.dmg'), other: null })
  })

  it('gives an Intel Mac, where Chromium says so, Intel’s dmg, with Apple silicon’s beside it', async () => {
    browse({ ua: UA.macChrome, arch: 'x86' })
    api({ assets: WITH_INTEL })
    expect(await (await lookup())()).toEqual({
      os: 'mac',
      href: url('Althar-0.2.0-x64.dmg'),
      other: { href: url('Althar-0.2.0-arm64.dmg'), label: 'Or for Apple silicon' },
    })
  })

  it('gives Safari, which never says the chip, Apple silicon’s dmg, with Intel’s beside it', async () => {
    browse({ ua: UA.macSafari })
    api({ assets: WITH_INTEL })
    expect(await (await lookup())()).toEqual({
      os: 'mac',
      href: url('Althar-0.2.0-arm64.dmg'),
      other: { href: url('Althar-0.2.0-x64.dmg'), label: 'Or for an Intel Mac' },
    })
  })

  it('sends an Intel Mac, where Chromium says so, to the releases page while no release has its build', async () => {
    browse({ ua: UA.macChrome, arch: 'x86' })
    api({ assets: SHIPPED })
    expect(await (await lookup())()).toBeNull()
  })

  it('gives Linux the AppImage, and Windows its exe only once a release has one', async () => {
    browse({ ua: UA.linux, arch: 'x86' })
    api({ assets: SHIPPED })
    expect(await (await lookup())()).toEqual({ os: 'linux', href: url('Althar-0.2.0.AppImage'), other: null })
    browse({ ua: UA.windows, arch: 'x86' })
    expect(await (await lookup())()).toBeNull()
    api({ assets: WITH_WINDOWS })
    expect(await (await lookup())()).toEqual({ os: 'windows', href: url('Althar-0.2.0-x64-setup.exe'), other: null })
  })

  it('sends a phone or a desktop-mode iPad to the releases page without asking the API', async () => {
    const fetch = api({ assets: SHIPPED })
    browse({ ua: UA.iphone, touches: 5 })
    expect(await (await lookup())()).toBeNull()
    browse({ ua: UA.ipadDesktop, touches: 5 })
    expect(await (await lookup())()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends a Mac to the releases page when the API is down, rate-limited, or has no published release', async () => {
    browse({ ua: UA.macSafari })
    api(new Error('offline'))
    expect(await (await lookup())()).toBeNull()
    api(403)
    expect(await (await lookup())()).toBeNull()
    api(404)
    expect(await (await lookup())()).toBeNull()
    api({ assets: [] })
    expect(await (await lookup())()).toBeNull()
  })

  it('asks the API once for the page, however many links ask', async () => {
    browse({ ua: UA.macSafari })
    const fetch = api({ assets: SHIPPED })
    const find = await lookup()
    const answers = await Promise.all([find(), find(), find()])
    expect(answers.map((a) => a?.href)).toEqual(Array<string>(3).fill(url('Althar-0.2.0-arm64.dmg')))
    expect(await find()).toEqual(answers[0])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('lets ?platform= stand for the whole system, chip included', async () => {
    browse({ ua: UA.macChrome, arch: 'arm', search: '?platform=linux' })
    api({ assets: SHIPPED })
    expect(await (await lookup())()).toEqual({ os: 'linux', href: url('Althar-0.2.0.AppImage'), other: null })
  })
})
