// ported from https://github.com/ben-vargas/ai-sdk-provider-claude-code/blob/main/src/map-claude-code-finish-reason.ts#L22
import type { JSONObject } from '@ai-sdk/provider'
import type { FinishReason, LanguageModelUsage } from 'ai'

// Aligned with @anthropic-ai/sdk BetaStopReason; declared locally to avoid coupling to a
// specific @anthropic-ai/sdk version (claude-agent-sdk bundles its own, at a different rev).
type BetaStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal' | 'compaction'

/**
 * Maps Claude Code SDK result subtypes to AI SDK finish reasons.
 *
 * @param subtype - The result subtype from Claude Code SDK
 * @returns The corresponding AI SDK finish reason with unified and raw values
 *
 * @example
 * ```typescript
 * const finishReason = mapClaudeCodeFinishReason('error_max_turns');
 * // Returns: 'length'
 * ```
 **/
export function mapClaudeCodeFinishReason(subtype?: string): FinishReason {
  switch (subtype) {
    case 'success':
      return 'stop'
    case 'error_max_turns':
      return 'length'
    case 'error_during_execution':
      return 'error'
    case undefined:
      return 'stop'
    default:
      // Unknown subtypes mapped to 'other' to distinguish from genuine completion
      return 'other'
  }
}

/**
 * Maps Anthropic stop reasons to the AiSDK equivalents so higher level
 * consumers can treat completion states uniformly across providers.
 */
const finishReasonMapping: Record<BetaStopReason, FinishReason> = {
  end_turn: 'stop',
  max_tokens: 'length',
  stop_sequence: 'stop',
  tool_use: 'tool-calls',
  pause_turn: 'other',
  refusal: 'content-filter',
  compaction: 'other'
}

/**
 * Maps Claude Code SDK result subtypes to AI SDK finish reasons.
 *
 * @param subtype - The result subtype from Claude Code SDK
 * @returns The corresponding AI SDK finish reason with unified and raw values
 *
 * @example
 * ```typescript
 * const finishReason = mapClaudeCodeFinishReason('error_max_turns');
 * // Returns: 'length'
 * ```
 **/
export function mapClaudeCodeStopReason(claudeStopReason: string | null): FinishReason {
  if (claudeStopReason === null) {
    return 'stop'
  }
  return finishReasonMapping[claudeStopReason as BetaStopReason] || 'other'
}

type ClaudeCodeUsage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/**
 * Converts Claude Code SDK usage to AI SDK v6 stable usage format.
 *
 * Maps Claude's flat token counts to the nested structure required by AI SDK v6:
 * - `cache_creation_input_tokens` → `inputTokens.cacheWrite`
 * - `cache_read_input_tokens` → `inputTokens.cacheRead`
 * - `input_tokens` → `inputTokens.noCache`
 * - `inputTokens.total` = sum of all input tokens
 * - `output_tokens` → `outputTokens.total`
 *
 * @param usage - Raw usage data from Claude Code SDK
 * @returns Formatted usage object for AI SDK v6
 */
export function convertClaudeCodeUsage(usage: ClaudeCodeUsage): LanguageModelUsage {
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite
    },
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined
    },
    raw: usage as JSONObject
  }
}

// Several providers expose a 1M context window, but the Claude Code CLI only
// budgets for it when the model id carries the `[1m]` suffix (parsed locally
// to switch /context budgeting to 1e6 tokens, then stripped before the API
// call). We append it for the providers/models we know serve 1M, gated on the
// official host so third-party redeployments (OpenRouter / Fireworks / etc.)
// don't claim a capacity their backend may not actually serve.
//
// DeepSeek: V4+ Pro and Flash both ship a 1M window.
// https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code
const DEEPSEEK_V4_PLUS_REGEX = /(\w+-)?deepseek-v([4-9]|\d{2,})([.-]\w+)*$/i
// MiMo: V2.5+ Pro/base support 1M; flash variants cap at 256K. MiMo's
// official Claude Code docs document the same `[1m]` suffix convention.
// https://platform.xiaomimimo.com/docs/zh-CN/integration/claudecode
const MIMO_V25_PLUS_REGEX = /(\w+-)?mimo-v(2\.[5-9]|2\.\d{2,}|[3-9]|\d{2,})([.-]\w+)*$/i

export function isDeepSeekOfficialHost(host: string | undefined): boolean {
  const trimmed = host?.trim()
  if (!trimmed) return false
  try {
    return new URL(trimmed).hostname.endsWith('api.deepseek.com')
  } catch {
    return false
  }
}

export function isMiMoOfficialHost(host: string | undefined): boolean {
  const trimmed = host?.trim()
  if (!trimmed) return false
  try {
    // Covers the standard endpoint (api.xiaomimimo.com) and Token Plan
    // regional endpoints (token-plan-cn / token-plan-sg / ... .xiaomimimo.com).
    // The leading-dot boundary keeps lookalikes (notxiaomimimo.com,
    // xiaomimimo.com.evil.com) from matching.
    const { hostname } = new URL(trimmed)
    return hostname === 'xiaomimimo.com' || hostname.endsWith('.xiaomimimo.com')
  } catch {
    return false
  }
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/** RFC3339 timestamp in the system local timezone (includes numeric offset). */
export function formatRfc3339WithLocalOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const offset = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${offset}`
  )
}

/**
 * Clock context for system prompts — uses the OS timezone (e.g. Asia/Shanghai).
 */
export type ChannelContextInput = {
  channelId: string
  channelType: string
  chatId?: string
}

export function buildChannelContext(channel: ChannelContextInput): string {
  const lines = [
    '## Current Channel',
    `- You are in an external messaging channel: **${channel.channelType}**.`,
    `- Channel ID: \`${channel.channelId}\` (use for \`mcp__claw__cron\` / \`mcp__claw__notify\` when needed).`
  ]
  if (channel.chatId) {
    lines.push(`- Chat ID: \`${channel.chatId}\` (this conversation).`)
  }
  lines.push(
    '- The user is messaging you through this channel — not the Cherry Studio desktop chat.',
    `- When creating scheduled tasks with \`mcp__claw__cron\`, set \`channel_ids\` to [\`${channel.channelId}\`] (this channel).`,
    '- When sending proactive updates with `mcp__claw__notify`, prefer this channel unless the user asks otherwise.'
  )
  return lines.join('\n')
}

export function buildCurrentTimeContext(now: Date = new Date()): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(now)
  const localRfc3339 = formatRfc3339WithLocalOffset(now)

  return [
    '## Current Time',
    `- Now (local): ${localRfc3339} (${weekday})`,
    `- Timezone: ${timeZone}`,
    `- Now (UTC): ${now.toISOString()}`,
    '- For one-time `mcp__claw__cron` `at` values, use the local timestamp above (with offset).'
  ].join('\n')
}

export function with1mContextSuffix(modelId: string | undefined, anthropicHost: string | undefined): string {
  if (!modelId) return ''
  if (/\[1m\]$/i.test(modelId)) return modelId

  if (isDeepSeekOfficialHost(anthropicHost)) {
    if (!DEEPSEEK_V4_PLUS_REGEX.test(modelId)) return modelId
    return `${modelId}[1m]`
  }

  if (isMiMoOfficialHost(anthropicHost)) {
    if (/flash/i.test(modelId)) return modelId
    if (!MIMO_V25_PLUS_REGEX.test(modelId)) return modelId
    return `${modelId}[1m]`
  }

  return modelId
}
