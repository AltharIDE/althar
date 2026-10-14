import { describe, expect, it } from 'vite-plus/test'

import { type Asset, pickAsset } from '../src/lib/download'

/*
 * Which of a release's files a system gets: the files as the release
 * workflow names them (.github/workflows/release.yml), with and without the
 * Windows installer it doesn't build yet.
 */

const url = (name: string) => `https://github.com/AltharIDE/althar/releases/download/v0.2.0/${name}`
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

const WITH_WINDOWS = [...SHIPPED, file('Althar-Setup-0.2.0.exe')]

describe('pickAsset', () => {
  it('gives a Mac the dmg, not the zip or its blockmap', () => {
    expect(pickAsset('mac', null, SHIPPED)?.name).toBe('Althar-0.2.0-arm64.dmg')
    expect(pickAsset('mac', 'arm', SHIPPED)?.browser_download_url).toBe(url('Althar-0.2.0-arm64.dmg'))
  })

  it('gives Linux the AppImage, not the deb or rpm', () => {
    expect(pickAsset('linux', null, SHIPPED)?.name).toBe('Althar-0.2.0.AppImage')
    expect(pickAsset('linux', 'x86', SHIPPED)?.name).toBe('Althar-0.2.0.AppImage')
  })

  it('gives Windows the exe once a release has one', () => {
    expect(pickAsset('windows', null, WITH_WINDOWS)?.name).toBe('Althar-Setup-0.2.0.exe')
    expect(pickAsset('windows', 'x86', WITH_WINDOWS)?.name).toBe('Althar-Setup-0.2.0.exe')
  })

  it('gives Windows nothing while no release has an exe', () => {
    expect(pickAsset('windows', null, SHIPPED)).toBeNull()
    expect(pickAsset('windows', 'x86', SHIPPED)).toBeNull()
  })

  it('gives an unknown system nothing', () => {
    expect(pickAsset(null, null, SHIPPED)).toBeNull()
    expect(pickAsset(null, 'arm', WITH_WINDOWS)).toBeNull()
  })

  it('gives a chip with no build nothing: an Intel Mac, an ARM Linux', () => {
    expect(pickAsset('mac', 'x86', SHIPPED)).toBeNull()
    expect(pickAsset('linux', 'arm', SHIPPED)).toBeNull()
  })

  it('gives nothing from a release with no files', () => {
    expect(pickAsset('mac', 'arm', [])).toBeNull()
    expect(pickAsset('linux', null, [])).toBeNull()
  })
})
