import { useState } from 'react'

import {
  Button,
  Icon,
  IconButton,
  Menu,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  PageEmpty,
  Segmented,
  SidePanel,
  SidePanelBody,
  Spinner,
} from '@althar/ui'

import { type Device, IPHONE, MODELS, PIXEL, type Platform, type Screen, SHOTS } from './data'
import { fitOf, Phone, useRoom } from './Phone'
import s from './directions.module.css'
import { ago } from '../../src/renderer/shared/time'

/*
 * Four takes on a device beside the conversation, each on the workbench as
 * the page beside it is (ADR-100), from the kit's SidePanel, menus and
 * buttons. What they share: the device is the lead's own (Devices.ts), the
 * person watches it at work, and starting it shows where it will be at once.
 *
 * - A · Beside, as a page: one device, picked in the head, at its own shape.
 * - B · One place for what runs: the dev server's page and each device as
 *   choices of one pane, so a task never has two things open beside it.
 * - C · Both at once: the iPhone and the Pixel side by side, the same screen
 *   on each, for an app that must look right on both.
 * - D · Screenshots first: what the lead took, large, newest first, and the
 *   live device a press away in Simulator's own window. What can ship before
 *   Althar streams a simulator's screen.
 */

export type DeviceState = 'running' | 'starting' | 'unavailable'

export interface Look {
  readonly state: DeviceState
  /** The lead is using it. */
  readonly driving: boolean
  readonly tap: { readonly x: number; readonly y: number; readonly key: number } | null
  readonly screens: Readonly<Record<Platform, Screen>>
  readonly onClose: () => void
}

const deviceOf = (platform: Platform): Device => (platform === 'ios' ? IPHONE : PIXEL)

/** Where a device opens outside Althar, in the words of each platform's own window. */
const outsideOf = (platform: Platform) => (platform === 'ios' ? 'Show in Simulator' : 'Show the emulator’s window')

/** A device fit to the room it has, starting or running. */
function Fitted({ device, look, padding = 32 }: { device: Device; look: Look; padding?: number }) {
  const { ref, room } = useRoom<HTMLDivElement>()
  const scale = fitOf(device, { width: room.width - padding * 2, height: room.height - padding * 2 })
  const starting = look.state === 'starting'
  return (
    <div ref={ref} className={s.stage}>
      {room.width > 0 && (
        <Phone
          device={device}
          screen={look.screens[device.platform]}
          scale={scale}
          driving={look.driving && !starting}
          tap={starting ? null : look.tap}
        >
          {starting && (
            <output className={s.starting}>
              <Spinner size="small" />
              <span>Starting {device.model}…</span>
            </output>
          )}
        </Phone>
      )}
    </div>
  )
}

/** Where iOS can't run: what the person does about it, and what runs here instead. */
function CantRun({ onAndroid }: { onAndroid?: () => void }) {
  return (
    <div className={s.cant}>
      <Icon name="computer" size={18} className={s.cantIcon} />
      <strong>iOS simulators need a Mac with Xcode</strong>
      <p>This computer runs Android. What the lead checks on an iPhone stays under Not checked, for you or a Mac.</p>
      {onAndroid !== undefined && (
        <Button size="small" onClick={onAndroid}>
          Start Pixel 8
        </Button>
      )}
    </div>
  )
}

/** The head's device: its name and its OS, opening every model this computer can start. */
function Picker({ platform, onPick }: { platform: Platform; onPick: (platform: Platform) => void }) {
  const device = deviceOf(platform)
  return (
    <Menu
      label="Device"
      width={260}
      trigger={
        <button type="button" className={s.picker}>
          <span className={s.model}>{device.model}</span>
          <span className={s.os}>{device.os}</span>
          <Icon name="chevronD" size={12} />
        </button>
      }
    >
      <MenuRadioGroup label="Device" value={device.model} onChange={(name) => onPick(name === 'Pixel 8' ? 'android' : 'ios')}>
        {MODELS.map((model) => (
          <MenuRadioItem key={model.name} value={model.name} hint={model.os}>
            {model.name}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuGroup label="This task">
        <MenuItem onSelect={() => undefined}>Start it afresh</MenuItem>
      </MenuGroup>
    </Menu>
  )
}

function Actions({ platform, state }: { platform: Platform; state: DeviceState }) {
  if (state !== 'running') return null
  return (
    <>
      <IconButton icon="image" label="Take a screenshot" size="small" />
      <IconButton icon="external" label={outsideOf(platform)} size="small" tooltipAlign="end" />
    </>
  )
}

/** A · Beside, as a page. */
export function Beside({ look }: { look: Look }) {
  const [platform, setPlatform] = useState<Platform>('ios')
  const cant = look.state === 'unavailable' && platform === 'ios'
  return (
    <SidePanel
      label="Device"
      className={s.panel}
      head={<Picker platform={platform} onPick={setPlatform} />}
      actions={<Actions platform={platform} state={cant ? 'unavailable' : look.state} />}
      onClose={look.onClose}
    >
      <SidePanelBody className={s.body}>
        {cant ? <CantRun onAndroid={() => setPlatform('android')} /> : <Fitted device={deviceOf(platform)} look={look} />}
      </SidePanelBody>
    </SidePanel>
  )
}

type Place = 'page' | Platform

/** B · One place for what runs. */
export function OnePlace({ look }: { look: Look }) {
  const [place, setPlace] = useState<Place>('ios')
  const cant = look.state === 'unavailable' && place === 'ios'
  return (
    <SidePanel
      label="What runs"
      className={s.panel}
      head={
        <Segmented<Place>
          label="What runs"
          value={place}
          onChange={setPlace}
          options={[
            { value: 'page', label: 'localhost:8081' },
            { value: 'ios', label: 'iPhone 16' },
            { value: 'android', label: 'Pixel 8' },
          ]}
        />
      }
      actions={
        place === 'page' ? (
          <IconButton icon="external" label="Open in your browser" size="small" />
        ) : (
          <Actions platform={place} state={cant ? 'unavailable' : look.state} />
        )
      }
      onClose={look.onClose}
    >
      <SidePanelBody className={s.body}>
        {place === 'page' ? (
          <div className={s.pageEmpty}>
            <PageEmpty>Metro, the dev server both phones load the app from, answers here.</PageEmpty>
          </div>
        ) : cant ? (
          <CantRun onAndroid={() => setPlace('android')} />
        ) : (
          <Fitted device={deviceOf(place)} look={look} />
        )}
      </SidePanelBody>
    </SidePanel>
  )
}

/** C · Both at once. */
export function Both({ look }: { look: Look }) {
  return (
    <SidePanel
      label="Devices"
      className={s.panel}
      head={<span className={s.heading}>iPhone 16 and Pixel 8</span>}
      actions={look.state === 'running' ? <IconButton icon="image" label="Take a screenshot of each" size="small" /> : null}
      onClose={look.onClose}
    >
      <SidePanelBody className={s.body}>
        <div className={s.pair}>
          {[IPHONE, PIXEL].map((device) => (
            <figure key={device.platform} className={s.half}>
              {look.state === 'unavailable' && device.platform === 'ios' ? (
                <CantRun />
              ) : (
                <Fitted
                  device={device}
                  look={{
                    ...look,
                    driving: look.driving && device.platform === 'android',
                    tap: device.platform === 'android' ? look.tap : null,
                  }}
                  padding={14}
                />
              )}
              <figcaption className={s.caption}>
                <span className={s.model}>{device.model}</span>
                <span className={s.os}>{device.os}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </SidePanelBody>
    </SidePanel>
  )
}

/** D · Screenshots first. */
export function Shots({ look }: { look: Look }) {
  const shots = look.state === 'unavailable' ? SHOTS.filter((one) => one.device.platform === 'android') : SHOTS
  const [chosen, setChosen] = useState(0)
  const shot = shots[Math.min(chosen, shots.length - 1)]
  const { ref, room } = useRoom<HTMLDivElement>()
  if (shot === undefined) return null
  const scale = fitOf(shot.device, { width: room.width - 48, height: room.height - 32 })
  return (
    <SidePanel
      label="Screenshots"
      className={s.panel}
      head={
        <span className={s.heading}>
          <span className={s.model}>{shot.device.model}</span>
          <span className={s.os}>{ago(shot.at)}</span>
        </span>
      }
      actions={
        <Button size="small" variant="quiet" icon="external">
          {shot.device.platform === 'ios' ? 'Show in Simulator' : 'Show live'}
        </Button>
      }
      onClose={look.onClose}
    >
      <SidePanelBody className={s.shotsBody}>
        <div ref={ref} className={s.stage}>
          {room.width > 0 && <Phone device={shot.device} screen={shot.screen} scale={scale} />}
        </div>
        <div className={s.strip}>
          {shots.map((one, at) => (
            <button
              key={`${one.device.platform}-${one.at}`}
              type="button"
              aria-pressed={at === chosen}
              className={s.thumb}
              onClick={() => setChosen(at)}
              title={`${one.device.model}, ${ago(one.at)}`}
            >
              <Phone device={one.device} screen={one.screen} scale={0.11} />
            </button>
          ))}
          {look.state === 'starting' && (
            <span className={s.thumbStarting}>
              <Spinner size="small" label="Starting iPhone 16" />
            </span>
          )}
        </div>
      </SidePanelBody>
    </SidePanel>
  )
}

export const DIRECTIONS = [
  { key: 'a', label: 'A · Beside, as a page', Panel: Beside },
  { key: 'b', label: 'B · One place for what runs', Panel: OnePlace },
  { key: 'c', label: 'C · Both at once', Panel: Both },
  { key: 'd', label: 'D · Screenshots first', Panel: Shots },
] as const

export type Direction = (typeof DIRECTIONS)[number]['key']
