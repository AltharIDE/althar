import { definePlugin } from 'vite-plus/lint/plugins'

import { oneClock } from './clock.js'
import { oneRemoval } from './removal.js'

/* Althar's own lint rules, one file each; vite.config.ts says where each applies. */
export default definePlugin({ meta: { name: 'althar' }, rules: { 'one-clock': oneClock, 'one-removal': oneRemoval } })
