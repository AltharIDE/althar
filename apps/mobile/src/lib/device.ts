import * as Haptics from 'expo-haptics'
import * as LocalAuthentication from 'expo-local-authentication'
import { Platform } from 'react-native'

/*
 * What the phone itself does for an answer: asks for Face ID (or the
 * fingerprint, or the passcode) before it gives the person's word, and
 * taps back once the Mac has it. Saying no never asks: refusing is always
 * safe (ADR-048: only an answer that lets an agent do more is the person's
 * word to protect).
 */

export type Proof = { readonly ok: true } | { readonly ok: false; readonly why: string }

/** Face ID before an answer that allows, merges or pushes. Where the phone has no biometrics, its passcode stands in. */
export const confirmIsYou = async (what: string): Promise<Proof> => {
  if (Platform.OS === 'web') return { ok: true }
  const enrolled = await LocalAuthentication.isEnrolledAsync()
  if (!enrolled) return { ok: false, why: 'Set up Face ID or a passcode on this phone to answer for you.' }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: what,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  })
  return result.success ? { ok: true } : { ok: false, why: result.error === 'user_cancel' ? 'Cancelled' : 'Not confirmed' }
}

export const tapDone = (): void => {
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
}

export const tapLight = (): void => {
  if (Platform.OS !== 'web') void Haptics.selectionAsync()
}
