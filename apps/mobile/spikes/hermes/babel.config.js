// The phone app has no babel.config.js, so Expo uses babel-preset-expo; the
// spike points at the app's installed copies. BABEL_PRESET=rn switches to
// React Native's own preset, for comparison. That preset alone can't bundle
// `effect` (its dist/index.js uses `export * as X from`, which
// @react-native/babel-preset 0.88 doesn't transform; babel-preset-expo does),
// so the rn variant adds @babel/plugin-transform-export-namespace-from; nor
// `import.meta` (effect's ConfigProvider.fromEnv reads `import.meta?.env`),
// which hermesc refuses, where babel-preset-expo rewrites it to
// `globalThis.__ExpoImportMetaRegistry`, so the rn variant rewrites it to `{}`.
// BABEL_PRESET=rn-plain leaves both out, to show the failures.
const importMetaAsObject = ({ types: t }) => ({
  visitor: {
    MetaProperty(path) {
      if (path.node.meta.name === 'import' && path.node.property.name === 'meta') path.replaceWith(t.objectExpression([]))
    },
  },
})
const MOBILE = require('node:path').resolve(__dirname, '../../node_modules')
module.exports = (api) => {
  const preset = process.env.BABEL_PRESET || 'expo'
  api.cache.using(() => preset)
  if (preset === 'rn-plain') return { presets: [[`${MOBILE}/@react-native/babel-preset`, {}]] }
  if (preset === 'rn')
    return {
      presets: [[`${MOBILE}/@react-native/babel-preset`, {}]],
      plugins: [`${MOBILE}/@babel/plugin-transform-export-namespace-from`, importMetaAsObject],
    }
  return { presets: [[`${MOBILE}/babel-preset-expo`, {}]] }
}
