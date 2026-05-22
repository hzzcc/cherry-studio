import { loggerService } from '@logger'

const logger = loggerService.withContext('ExternalContentGuard')

/**
 * Zero-width and invisible Unicode characters commonly used for steganographic
 * injection or to confuse text-based boundary matching.
 */
const INVISIBLE_CHARS_RE =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: intentional invisible char class
  // oxlint-disable-next-line no-misleading-character-class -- intentional invisible char detection
  // eslint-disable-next-line no-misleading-character-class
  /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD\u2060\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\u206A-\u206F]/g

/**
 * Suspicious prompt-injection patterns (advisory — logged, not blocked).
 * Borrowed from OpenClaw's external-content.ts approach.
 */
const SUSPICIOUS_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore-previous', re: /ignore\s+(all\s+)?previous\s+instructions/i },
  { name: 'ignore-above', re: /ignore\s+(all\s+)?above\s+instructions/i },
  { name: 'disregard-previous', re: /disregard\s+(all\s+)?previous/i },
  { name: 'role-override', re: /you\s+are\s+now\s+/i },
  { name: 'new-instructions', re: /new\s+instructions?\s*:/i },
  { name: 'system-prefix', re: /^\s*system\s*:\s*/im },
  { name: 'eval-call', re: /\beval\s*\(/i },
  { name: 'rm-rf', re: /\brm\s+-rf\b/i },
  { name: 'read-ssh-key', re: /\.ssh\/(id_rsa|id_ed25519|authorized_keys)/i },
  { name: 'read-env-file', re: /\bcat\s+.*\.env\b/i },
  { name: 'exfil-curl', re: /curl\s+.*-d\s/i },
  { name: 'fake-boundary', re: /<<<\s*EXTERNAL/i }
]

/**
 * Full-width and CJK angle brackets → ASCII (prevents boundary tag spoofing).
 */
function normalizeAngleBrackets(text: string): string {
  return text
    .replace(/\uFF1C/g, '<') // fullwidth <
    .replace(/\uFF1E/g, '>') // fullwidth >
    .replace(/\u3008/g, '<') // CJK left angle
    .replace(/\u3009/g, '>') // CJK right angle
}

export type ExternalContentMetadata = {
  chatId: string
  userId: string
  userName: string
  channelType: string
}

/**
 * Strip invisible characters from untrusted text.
 */
export function sanitizeInvisibleChars(text: string): string {
  return text.replace(INVISIBLE_CHARS_RE, '')
}

/**
 * Detect suspicious prompt-injection patterns in text.
 * Returns an array of matched pattern names (empty if clean).
 */
export function detectSuspiciousPatterns(text: string): string[] {
  return SUSPICIOUS_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name)
}

/**
 * Normalize channel message text before it is sent to the agent.
 * Strips invisible Unicode and normalizes angle brackets only — no LLM-facing
 * security notices or untrusted-content boundary wrappers.
 */
export function wrapExternalContent(text: string, metadata: ExternalContentMetadata): string {
  let cleaned = normalizeAngleBrackets(text)
  cleaned = sanitizeInvisibleChars(cleaned)

  const suspicious = detectSuspiciousPatterns(cleaned)
  if (suspicious.length > 0) {
    logger.warn('Suspicious patterns detected in channel message', {
      chatId: metadata.chatId,
      userId: metadata.userId,
      channelType: metadata.channelType,
      patterns: suspicious
    })
  }

  return cleaned
}
