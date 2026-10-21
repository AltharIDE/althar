// Bundles an entry the way `expo export` / `react-native bundle` would for a
// release build: Metro, platform ios, dev=false, minify, Hermes engine
// (customTransformOptions.engine = 'hermes', transform profile hermes-stable).
//   node build.cjs <entry> <out.js> [expo|rn]
const path = require('node:path')
const fs = require('node:fs')

const MOBILE = path.resolve(__dirname, '../../node_modules')
const CONTRACTS = path.resolve(__dirname, '../../../../packages/contracts')
const EFFECT = fs.realpathSync(`${CONTRACTS}/node_modules/effect`)
const SPIKE = __dirname

const [entry, out, preset = 'expo'] = process.argv.slice(2)
process.env.BABEL_PRESET = preset

const Metro = require(`${MOBILE}/metro`)
const { getDefaultConfig, mergeConfig } = require(`${MOBILE}/metro-config`)
const { FileStore } = require(`${MOBILE}/metro-cache`)

const main = async () => {
  const base = await getDefaultConfig(SPIKE)
  const config = mergeConfig(base, {
    projectRoot: SPIKE,
    watchFolders: [SPIKE, CONTRACTS, EFFECT, MOBILE],
    cacheStores: [new FileStore({ root: path.join(SPIKE, '.metro-cache', preset) })],
    resetCache: true,
    maxWorkers: 2,
    reporter: { update: (event) => (event.type === 'bundling_error' || event.type === 'worker_stderr_chunk' || event.type === 'error') && console.error(event) },
    resolver: {
      useWatchman: false,
      blockList: [/\/hermes-spike\/(vendor|out|\.metro-cache)\//, /\/__tests__\//],
      nodeModulesPaths: [MOBILE],
      // One copy of Effect, the one the contract resolves: a second (the app's node_modules has its own
      // since it took effect as a dependency) breaks Schema and RPC across the boundary
      // ("SchemaError: Expected an integer", "Expected JSON value").
      // TWO_EFFECTS=1 leaves this out, to show what two copies do.
      resolveRequest: (context, moduleName, platform) =>
        process.env.TWO_EFFECTS !== '1' && (moduleName === 'effect' || moduleName.startsWith('effect/'))
          ? context.resolveRequest({ ...context, originModulePath: `${CONTRACTS}/src/index.ts` }, moduleName, platform)
          : context.resolveRequest(context, moduleName, platform),
      extraNodeModules: { '@althar/contracts': CONTRACTS, effect: EFFECT },
      sourceExts: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json'],
      unstable_enablePackageExports: true,
      unstable_conditionNames: ['react-native', 'require', 'default'],
    },
    transformer: {
      babelTransformerPath:
        preset.startsWith('rn')
          ? require.resolve(`${MOBILE}/@react-native/metro-babel-transformer`)
          : require.resolve(`${MOBILE}/@expo/metro-config/build/babel-transformer`),
      getTransformOptions: async () => ({ transform: { experimentalImportSupport: false, inlineRequires: false } }),
    },
    serializer: {
      // No React Native runtime here: no InitializeCore, no RN js-polyfills.
      getPolyfills: () => [],
      getModulesRunBeforeMainModule: () => [],
    },
  })
  await Metro.runBuild(config, {
    entry: path.resolve(SPIKE, entry),
    out: path.resolve(SPIKE, out),
    platform: 'ios',
    dev: false,
    minify: true,
    sourceMap: false,
    // Metro skips terser for the hermes-* profiles (hermesc optimizes); MINIFY=1 bundles with profile 'default' so terser runs too.
    unstable_transformProfile: process.env.MINIFY === '1' ? 'default' : 'hermes-stable',
    customTransformOptions: { engine: 'hermes' },
  })
  const size = fs.statSync(path.resolve(SPIKE, out)).size
  console.log(`bundled ${entry} -> ${out} (${(size / 1024).toFixed(0)} KiB, preset ${preset}${process.env.MINIFY === '1' ? ', minified with terser' : ''})`)
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
