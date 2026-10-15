import { runStories, type StoryFile } from './stories'

runStories(import.meta.glob<StoryFile>(['../src/setup/**/*.stories.tsx', '../src/coordinator/**/*.stories.tsx'], { eager: true }))
