import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The new-project lab: setting up a project in a folder with no remote, on
 * the kit's own NewProject, RepositoryMap and ChangeSet, with no runtime.
 * Directions A–D and folder states 1–8 swap in place (README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 6163, strictPort: true },
})
