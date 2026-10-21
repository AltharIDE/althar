import { getRandomValues } from 'expo-crypto'

/*
 * What the app needs that React Native and Expo don't install
 * (docs/hermes-spike.md): `crypto.getRandomValues`, for command ids. Imported
 * first, before anything that might ask for it.
 */

const global = globalThis as { crypto?: Partial<Crypto> }
if (typeof global.crypto?.getRandomValues !== 'function') {
  global.crypto = { ...global.crypto, getRandomValues: getRandomValues as Crypto['getRandomValues'] }
}
