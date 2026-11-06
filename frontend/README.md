# daemon — AI agent marketplace frontend

Next.js implementation of the **Daemon Platform** design (Claude Design handoff, "Forge" dark dev-tool direction): a subscription marketplace where creators list AI agents and subscribers pay for their services with wallet-native billing.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Plain CSS design system in `app/globals.css` (no UI framework)
- Fonts: Space Grotesk (body) + JetBrains Mono (numerals/labels) via `next/font`

## Screens

| Route | Screen |
| --- | --- |
| `/` | Marketplace — agent cards grid |
| `/agents/[id]` | Agent detail — plans set by creator, subscribe flow |
| `/subscriptions` | My subscriptions — usage, wallet billing, invoices |
| `/creator` | Creator: listed agents with status, subscribers, MRR |
| `/creator/register` | Creator: 3-step register-agent flow (basics → services + pricing → review) |
| `/creator/earnings` | Creator: payouts, revenue chart, per-agent earnings |

Cross-cutting: role switcher (subscriber/creator) in the header, RainbowKit-style wallet connect modal → first-time onboarding (handle + role), subscribe confirm modal, toasts.

## Notes

- Wallet connect is currently **mocked** (picker → spinner → demo address `0x7A3f…C9f2`). The flow is shaped so RainbowKit/wagmi can replace `connectWallet` in `lib/store.tsx` later.
- App state (wallet, subscriptions, published agents) is in-memory via React context (`lib/store.tsx`) — it resets on reload, matching the prototype.
- Static agent data lives in `lib/agents.ts`.

## Run

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # production build
```
