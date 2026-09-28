/*
 * Which mark stands for a lab or a source: pure lookups, kept apart from the
 * components that draw marks. A consumer resolves its data with these and
 * hands components a Brand.
 */
import { Lab, SourceKind, unreachable } from '../vocabulary'
import { Brand } from './brands'

/** The mark a lab's models carry: the model family's own where it has one (Claude, Gemini, Qwen), the lab's otherwise. */
export function labBrand(lab: Lab): Brand {
  switch (lab) {
    case Lab.Anthropic:
      return Brand.Anthropic
    case Lab.OpenAI:
      return Brand.OpenAI
    case Lab.Google:
      return Brand.Google
    case Lab.Meta:
      return Brand.Meta
    case Lab.Mistral:
      return Brand.Mistral
    case Lab.DeepSeek:
      return Brand.DeepSeek
    case Lab.XAI:
      return Brand.XAI
    case Lab.Alibaba:
      return Brand.Alibaba
    case Lab.Moonshot:
      return Brand.Moonshot
    case Lab.Zai:
      return Brand.Zai
    case Lab.MiniMax:
      return Brand.MiniMax
    case Lab.Cohere:
      return Brand.Cohere
    case Lab.Microsoft:
      return Brand.Microsoft
    case Lab.Amazon:
      return Brand.Amazon
    case Lab.Nvidia:
      return Brand.Nvidia
    case Lab.IBM:
      return Brand.IBM
    case Lab.Perplexity:
      return Brand.Perplexity
    case Lab.AI21:
      return Brand.AI21
    case Lab.Baidu:
      return Brand.Baidu
    case Lab.ByteDance:
      return Brand.ByteDance
    case Lab.Tencent:
      return Brand.Tencent
    case Lab.StepFun:
      return Brand.StepFun
    case Lab.HuggingFace:
      return Brand.HuggingFace
    case Lab.Ai2:
      return Brand.Ai2
    case Lab.Liquid:
      return Brand.Liquid
    case Lab.Reka:
      return Brand.Reka
    case Lab.NousResearch:
      return Brand.NousResearch
    case Lab.Inflection:
      return Brand.Inflection
    default:
      return unreachable(lab)
  }
}

/** The brand a source is drawn with, or null for one that has none. */
export function sourceBrand(kind: SourceKind): Brand | null {
  switch (kind) {
    case SourceKind.GitHub:
      return Brand.GitHub
    case SourceKind.GitLab:
      return Brand.GitLab
    case SourceKind.Bitbucket:
      return Brand.Bitbucket
    case SourceKind.Linear:
      return Brand.Linear
    case SourceKind.Jira:
      return Brand.Jira
    case SourceKind.Confluence:
      return Brand.Confluence
    case SourceKind.Trello:
      return Brand.Trello
    case SourceKind.Opsgenie:
      return Brand.Opsgenie
    case SourceKind.Statuspage:
      return Brand.Statuspage
    case SourceKind.Loom:
      return Brand.Loom
    case SourceKind.Ci:
      return null
    default:
      return unreachable(kind)
  }
}
