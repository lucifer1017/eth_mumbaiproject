import { ulid } from 'ulid'
import { pool, query } from './pool.js'
import { logger } from '../logger.js'

interface SeedAgent {
  slug: string
  name: string
  category: string
  tagline: string
  short_description: string
  description: string
  services: string[]
  rating: number
  rating_count: number
  base_subscriber_count: number
  publisher_name: string
  mode: 'subscription' | 'one_time' | 'both'
  sub_price_amount: number | null
  sub_price_currency: string
  interval_seconds: number | null
  payment_frequency: string | null
  one_time_price_amount: number | null
  agent_invoke_fee: number | null
  service_address: string | null
  onchain_agent_id: string | null
  endpoint_url: string | null
}

const CDN = 'https://cdn.daemonagents.com/agents'

const AGENTS: SeedAgent[] = [
  {
    slug: 'pulse',
    name: 'Pulse',
    category: 'finance',
    tagline: 'dca-agent',
    short_description: 'Dollar-cost averages into your portfolio on a schedule you set — no charts, no stress.',
    description: 'Pulse executes a disciplined dollar-cost averaging strategy across the assets you pick. Set a schedule and a budget; it buys through your linked wallet on Arbitrum, rebalances drift, and sends a plain-language summary after every run.',
    services: ['auto-dca', 'rebalance', 'alerts'],
    rating: 4.8,
    rating_count: 312,
    base_subscriber_count: 1200,
    publisher_name: 'Meridian Labs',
    mode: 'subscription',
    sub_price_amount: 19.00,
    sub_price_currency: 'USDC',
    interval_seconds: 604800, // weekly
    payment_frequency: 'weekly',
    one_time_price_amount: null,
    agent_invoke_fee: null,
    service_address: '0x102bA9E4Ad057EFE5233B77c09B6DBb2Df6fFa09',
    onchain_agent_id: '1',
    endpoint_url: 'http://agent_dca:8402'
  },
  {
    slug: 'tidy',
    name: 'Tidy',
    category: 'productivity',
    tagline: 'organiser-agent',
    short_description: 'Keeps your inbox, calendar and task list in order — triages, schedules and reminds.',
    description: 'Tidy connects to your email and calendar, triages what arrives, schedules what needs a slot, and keeps a running task list it actually maintains.',
    services: ['inbox-triage', 'scheduling', 'tasks'],
    rating: 4.7,
    rating_count: 980,
    base_subscriber_count: 3400,
    publisher_name: 'Northbeam',
    mode: 'subscription',
    sub_price_amount: 12.00,
    sub_price_currency: 'USDC',
    interval_seconds: 2592000, // monthly
    payment_frequency: 'monthly',
    one_time_price_amount: null,
    agent_invoke_fee: null,
    service_address: null,
    onchain_agent_id: null,
    endpoint_url: 'https://api.tidyagent.com/v1'
  },
  {
    slug: 'pathfinder',
    name: 'Pathfinder',
    category: 'career',
    tagline: 'jobfinder-agent',
    short_description: 'Hunts job boards overnight, tailors your CV per role and tracks every application.',
    description: 'Pathfinder scans boards and company pages overnight against your profile, ranks matches, tailors your CV and cover letter per role, and submits with your approval.',
    services: ['job-match', 'cv-tailor', 'tracking'],
    rating: 4.9,
    rating_count: 410,
    base_subscriber_count: 860,
    publisher_name: 'Coldfront',
    mode: 'both',
    sub_price_amount: 24.00,
    sub_price_currency: 'USDC',
    interval_seconds: 2592000,
    payment_frequency: 'monthly',
    one_time_price_amount: 0.50,
    agent_invoke_fee: null,
    service_address: null,
    onchain_agent_id: null,
    endpoint_url: 'https://api.pathfinderagent.com/v1'
  },
  {
    slug: 'clerk',
    name: 'Clerk',
    category: 'finance',
    tagline: 'bookkeeping-agent',
    short_description: 'Categorizes transactions, reconciles monthly and hands your accountant clean books.',
    description: 'Clerk watches your business accounts, categorizes every transaction against your chart of accounts, reconciles at month end, and exports accountant-ready books.',
    services: ['categorize', 'reconcile', 'exports'],
    rating: 4.6,
    rating_count: 305,
    base_subscriber_count: 640,
    publisher_name: 'Quietbooks',
    mode: 'one_time',
    sub_price_amount: null,
    sub_price_currency: 'USDC',
    interval_seconds: null,
    payment_frequency: null,
    one_time_price_amount: 0.04,
    agent_invoke_fee: null,
    service_address: null,
    onchain_agent_id: null,
    endpoint_url: 'https://api.clerkagent.com/v1'
  },
  {
    slug: 'scribe',
    name: 'Scribe',
    category: 'productivity',
    tagline: 'notes-agent',
    short_description: 'Joins your meetings, writes decisions-first notes and chases the action items.',
    description: 'Scribe sits in on your calls, produces decisions-first notes within minutes, and follows up on action items with owners until they are done or escalated.',
    services: ['meeting-notes', 'action-items', 'follow-ups'],
    rating: 4.7,
    rating_count: 740,
    base_subscriber_count: 2100,
    publisher_name: 'Stanza',
    mode: 'subscription',
    sub_price_amount: 15.00,
    sub_price_currency: 'USDC',
    interval_seconds: 2592000,
    payment_frequency: 'monthly',
    one_time_price_amount: null,
    agent_invoke_fee: null,
    service_address: null,
    onchain_agent_id: null,
    endpoint_url: 'https://api.scribeagent.com/v1'
  },
  {
    slug: 'watchdog',
    name: 'Watchdog',
    category: 'engineering',
    tagline: 'monitor-agent',
    short_description: 'Watches your sites and APIs, fixes routine incidents and writes the post-mortem.',
    description: 'Watchdog monitors uptime and performance, handles routine remediations like restarts and rollbacks autonomously, and posts a clear post-mortem to your channel after every incident.',
    services: ['uptime', 'auto-fix', 'post-mortems'],
    rating: 4.8,
    rating_count: 312,
    base_subscriber_count: 990,
    publisher_name: 'Stackwatch',
    mode: 'subscription',
    sub_price_amount: 29.00,
    sub_price_currency: 'USDC',
    interval_seconds: 2592000,
    payment_frequency: 'monthly',
    one_time_price_amount: null,
    agent_invoke_fee: null,
    service_address: null,
    onchain_agent_id: null,
    endpoint_url: 'https://api.watchdogagent.com/v1'
  },
  {
    slug: 'risk-analyzer',
    name: 'Wallet Risk Analyzer',
    category: 'finance',
    tagline: 'risk-agent',
    short_description: 'Scans a wallet\'s holdings and flags concentration, volatility and liquidity risks.',
    description: 'Wallet Risk Analyzer reads a wallet\'s on-chain holdings, prices them live, and returns a plain-language report on concentration, volatility and liquidity risk with concrete suggestions.',
    services: ['risk-report', 'portfolio-analysis'],
    rating: 4.7,
    rating_count: 120,
    base_subscriber_count: 410,
    publisher_name: 'SIP Labs',
    mode: 'one_time',
    sub_price_amount: null,
    sub_price_currency: 'USDC',
    interval_seconds: null,
    payment_frequency: null,
    one_time_price_amount: 0.10,
    agent_invoke_fee: 0.05,
    service_address: null,
    onchain_agent_id: null,
    endpoint_url: 'http://agent_risk_analyzer:8403'
  }
]

async function main(): Promise<void> {
  for (const agent of AGENTS) {
    const existing = await query<{ agent_id: string }>('SELECT agent_id FROM agents WHERE slug = $1', [agent.slug])

    let agentId: string
    if (existing.rows.length > 0) {
      agentId = existing.rows[0]!.agent_id
      logger.info({ slug: agent.slug, agentId }, 'agent already seeded — updating')
      await query(
        `UPDATE agents SET
          name=$2, icon=$3, logo=$4, category=$5, tagline=$6, short_description=$7, description=$8,
          services=$9, rating=$10, rating_count=$11, publisher_name=$12, mode=$13, sub_price_amount=$14,
          sub_price_currency=$15, interval_seconds=$16, payment_frequency=$17, one_time_price_amount=$18,
          service_address=$19, onchain_agent_id=$20, endpoint_url=$21, base_subscriber_count=$22, agent_invoke_fee=$23
         WHERE agent_id=$1`,
        [
          agentId, agent.name, `${CDN}/${agent.slug}/icon.png`, `${CDN}/${agent.slug}/logo.png`,
          agent.category, agent.tagline, agent.short_description, agent.description, agent.services,
          agent.rating, agent.rating_count, agent.publisher_name, agent.mode,
          agent.sub_price_amount ? String(agent.sub_price_amount) : null,
          agent.sub_price_currency, agent.interval_seconds, agent.payment_frequency,
          agent.one_time_price_amount ? String(agent.one_time_price_amount) : null,
          agent.service_address, agent.onchain_agent_id, agent.endpoint_url, agent.base_subscriber_count,
          agent.agent_invoke_fee ? String(agent.agent_invoke_fee) : null,
        ]
      )
    } else {
      agentId = `agt_${ulid()}`
      await query(
        `INSERT INTO agents (
          agent_id, slug, name, icon, logo, category, tagline, short_description, description,
          services, rating, rating_count, publisher_name, mode, sub_price_amount, sub_price_currency,
          interval_seconds, payment_frequency, one_time_price_amount, service_address, onchain_agent_id,
          endpoint_url, base_subscriber_count, status, onchain, trust_score, agent_invoke_fee
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'live',true,80,$24)`,
        [
          agentId, agent.slug, agent.name, `${CDN}/${agent.slug}/icon.png`, `${CDN}/${agent.slug}/logo.png`,
          agent.category, agent.tagline, agent.short_description, agent.description, agent.services,
          agent.rating, agent.rating_count, agent.publisher_name, agent.mode,
          agent.sub_price_amount ? String(agent.sub_price_amount) : null,
          agent.sub_price_currency, agent.interval_seconds, agent.payment_frequency,
          agent.one_time_price_amount ? String(agent.one_time_price_amount) : null,
          agent.service_address, agent.onchain_agent_id, agent.endpoint_url, agent.base_subscriber_count,
          agent.agent_invoke_fee ? String(agent.agent_invoke_fee) : null,
        ]
      )
      logger.info({ slug: agent.slug, agentId }, 'agent seeded')
    }
  }

  logger.info('seed complete')
  await pool.end()
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'seed failed')
  process.exit(1)
})
