import Anthropic from '@anthropic-ai/sdk'
import { logger } from '../logger.js'
import { config } from '../config.js'

export interface AgentBlurb {
  /** A few words for the card meta line, e.g. "Uptime + alerting, on autopilot". */
  tagline: string
  /** One sentence shown on the marketplace card. */
  short_description: string
}

/** Trim to the first sentence (or N chars) — used when no LLM is available. */
function truncate(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (clean.length <= max) return clean
  const sentenceEnd = clean.slice(0, max).lastIndexOf('. ')
  if (sentenceEnd > 40) return clean.slice(0, sentenceEnd + 1)
  return clean.slice(0, max).trimEnd() + '…'
}

function fallbackBlurb(name: string, longDescription: string): AgentBlurb {
  const firstSentence = longDescription.split(/(?<=[.!?])\s/)[0] ?? longDescription
  return {
    tagline: truncate(firstSentence, 60),
    short_description: truncate(longDescription, 140),
  }
}

const SYSTEM_PROMPT = `You write marketplace copy for autonomous AI agents.
Given an agent's name and a long description, produce two things:
1. "tagline" — at most 8 words, punchy, no period, describing what it does.
2. "short_description" — exactly one sentence (max ~140 chars) a subscriber sees on the agent's card.

Respond ONLY with a JSON object, no markdown:
{"tagline": "...", "short_description": "..."}`

/**
 * Generate a card tagline + short description from a creator's long
 * description. Uses Claude when ANTHROPIC_API_KEY is set, otherwise falls
 * back to deterministic truncation so registration never fails.
 */
export async function generateAgentBlurb(name: string, longDescription: string): Promise<AgentBlurb> {
  const desc = longDescription?.trim()
  if (!desc) return { tagline: name, short_description: name }
  if (!config.anthropicApiKey) return fallbackBlurb(name, desc)

  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Agent name: ${name}\n\nDescription:\n${desc}` }],
    })

    const raw = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')

    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1) return fallbackBlurb(name, desc)

    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<AgentBlurb>
    return {
      tagline: (parsed.tagline?.trim() || fallbackBlurb(name, desc).tagline).slice(0, 80),
      short_description:
        (parsed.short_description?.trim() || fallbackBlurb(name, desc).short_description).slice(0, 200),
    }
  } catch (err) {
    logger.warn({ err }, 'agent blurb generation failed — falling back to truncation')
    return fallbackBlurb(name, desc)
  }
}
