import { Brand } from '../../foundations/brands/brands'
import type { ServerStarter } from './tools'

/** The servers people add most, offered where there are none yet; each fills the Add form in. */
export const SERVER_STARTERS: readonly ServerStarter[] = [
  { name: 'github', way: 'address', runs: 'https://api.githubcopilot.com/mcp/', brand: Brand.GitHub },
  { name: 'linear', way: 'address', runs: 'https://mcp.linear.app/mcp', brand: Brand.Linear },
  { name: 'figma', way: 'address', runs: 'https://mcp.figma.com/mcp' },
  { name: 'notion', way: 'address', runs: 'https://mcp.notion.com/mcp' },
  { name: 'playwright', way: 'command', runs: 'npx @playwright/mcp@latest' },
]
