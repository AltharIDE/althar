import { runStories, type StoryFile } from './stories'

runStories(import.meta.glob<StoryFile>(['../src/thread/**/*.stories.tsx'], { eager: true }))
