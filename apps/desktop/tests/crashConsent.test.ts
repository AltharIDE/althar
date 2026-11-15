import { expect, it } from 'vitest'

import { crashConsent } from '../src/main/crashConsent'

it('pauses before an off choice is written, and stays off once it is kept', () => {
  let kept = true
  const consent = crashConsent(() => kept)
  const before = consent.generation()
  expect(consent.allowed()).toBe(true)
  const finish = consent.changing()
  expect(consent.allowed()).toBe(false)
  expect(consent.generation()).not.toBe(before)
  kept = false
  finish()
  expect(consent.allowed()).toBe(false)
})

it('enables only after an on choice has been kept', () => {
  let kept = false
  const consent = crashConsent(() => kept)
  const finish = consent.changing()
  kept = true
  expect(consent.allowed()).toBe(false)
  finish()
  expect(consent.allowed()).toBe(true)
})

it('never lets an earlier on write undo a newer pending off choice', () => {
  let kept = false
  const consent = crashConsent(() => kept)
  const on = consent.changing()
  const off = consent.changing()
  const pending = consent.generation()
  kept = true
  on()
  expect(consent.allowed()).toBe(false)
  expect(consent.generation()).toBe(pending)
  kept = false
  off()
  expect(consent.allowed()).toBe(false)
})

it('allows a newer on write to follow off without reviving reports from before it', () => {
  let kept = true
  const consent = crashConsent(() => kept)
  const before = consent.generation()
  const off = consent.changing()
  const on = consent.changing()
  kept = false
  off()
  expect(consent.allowed()).toBe(false)
  kept = true
  on()
  expect(consent.allowed()).toBe(true)
  expect(consent.generation()).not.toBe(before)
})

it('uses the actual preference after a failed write, and finishing twice changes nothing', () => {
  const consent = crashConsent(() => true)
  const before = consent.generation()
  const finish = consent.changing()
  expect(consent.allowed()).toBe(false)
  // The disk write failed: the previous preference is still what was kept.
  finish()
  expect(consent.allowed()).toBe(true)
  const after = consent.generation()
  expect(after).not.toBe(before)
  finish()
  expect(consent.generation()).toBe(after)
})

it('cannot enable reporting when the current policy forbids it', () => {
  let doNotTrack = false
  const consent = crashConsent(() => !doNotTrack)
  expect(consent.allowed()).toBe(true)
  doNotTrack = true
  consent.changing()()
  expect(consent.allowed()).toBe(false)
})
