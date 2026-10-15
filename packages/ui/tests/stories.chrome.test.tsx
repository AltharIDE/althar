import { runStories, type StoryFile } from './stories'

runStories(import.meta.glob<StoryFile>(['../src/chrome/**/*.stories.tsx'], { eager: true }))
