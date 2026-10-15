import { runStories, type StoryFile } from './stories'

runStories(import.meta.glob<StoryFile>(['../src/screens/**/*.stories.tsx', '../src/composer/**/*.stories.tsx'], { eager: true }))
