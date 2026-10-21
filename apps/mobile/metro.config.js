// @ts-check
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

/*
 * Metro, with the runtime's contract (packages/contracts) read from its
 * source, as the desktop reads it. The contract and the app share one Effect,
 * the app's: resolved from here, whichever file asks for it, since two
 * copies of Effect can't talk to each other.
 */

const contracts = path.resolve(__dirname, '../../packages/contracts')
const here = path.join(__dirname, 'package.json')

const config = getDefaultConfig(__dirname)
config.watchFolders = [...(config.watchFolders ?? []), contracts]

const upstream = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest
  if (moduleName === '@althar/contracts') return resolve({ ...context, originModulePath: here }, path.join(contracts, 'src/index.ts'), platform)
  if (moduleName === 'effect' || moduleName.startsWith('effect/')) return resolve({ ...context, originModulePath: here }, moduleName, platform)
  return resolve(context, moduleName, platform)
}

module.exports = config
