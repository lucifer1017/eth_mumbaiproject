import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { DEFAULT_SECTION, DOC_SECTIONS, isValidSection } from "../sections";

export function generateStaticParams() {
  return [{ slug: [] as string[] }, ...DOC_SECTIONS.map((s) => ({ slug: [s.slug] }))];
}

const ARBISCAN = "https://sepolia.arbiscan.io/address";

// Deployed addresses, kept in sync with contracts/deployments/arbitrum-sepolia.json.
const DEPLOYMENTS: { name: string; role: string; address: string }[] = [
  {
    name: "Subscriptions",
    role: "Core protocol for the subscription path. Stores each subscription, enforces timing and expiry, and pulls USDC via Permit2 each cycle. Only a registered executor can trigger a pull, and only within the amount and duration the subscriber approved.",
    address: "0xdeA11fC11A86a2c3bD70F5D37087C869F0bf88Ed",
  },
  {
    name: "ServiceFactory",
    role: "Deploys a per-agent Service contract when a subscription-capable agent registers, and whitelists it on Subscriptions.",
    address: "0x91F9f2d566098EB22642D2f0a692352f45DD8bd3",
  },
  {
    name: "Permit2",
    role: "Canonical Uniswap Permit2. Signature-based USDC allowances, so funds are pulled only within approved parameters.",
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  },
  {
    name: "Mock USDC",
    role: "Test spend token used to fund and pay subscriptions on Arbitrum Sepolia.",
    address: "0x6Fd5c8aF495B2811288B9491932dc2bC079a9691",
  },
  {
    name: "Mock WETH",
    role: "Test output token for DCA-style example agents.",
    address: "0xe8D355544f832B731D7Bd040B8D6d4eE959b6401",
  },
  {
    name: "Mock WBTC",
    role: "Test output token for DCA-style example agents.",
    address: "0x13b0D6bBa80860b5e9b62561a3Ff1f5a2Fa4436c",
  },
];

// ── small diagram primitives ───────────────────────────────────────────────

function Node({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: "accent" | "green" | "muted";
}) {
  return <div className={`docs-node${variant ? ` ${variant}` : ""}`}>{children}</div>;
}

function Arrow({ label }: { label?: string }) {
  return label ? (
    <span className="docs-arrow tag" data-label={label} aria-hidden>
      →
    </span>
  ) : (
    <span className="docs-arrow" aria-hidden>
      →
    </span>
  );
}

function Row({ children, center }: { children: ReactNode; center?: boolean }) {
  return <div className={`docs-diagram-row wrap${center ? " center" : ""}`}>{children}</div>;
}

// ── flow diagrams ──────────────────────────────────────────────────────────

function SystemDiagram() {
  return (
    <div className="docs-diagram">
      <div className="docs-diagram-stack">
        <div className="docs-layer">
          <div className="docs-layer-label">participants</div>
          <Row center>
            <Node>Agent Creator</Node>
            <Node>Subscriber</Node>
          </Row>
        </div>
        <div className="docs-flow-down">↓</div>
        <div className="docs-layer">
          <div className="docs-layer-label">frontend · Next.js</div>
          <Row center>
            <Node>Marketplace</Node>
            <Node>Agent detail</Node>
            <Node>Portfolio</Node>
            <Node>Creator console</Node>
          </Row>
        </div>
        <div className="docs-flow-down">↓</div>
        <div className="docs-cols">
          <div className="docs-layer">
            <div className="docs-layer-label">backend · Node (no custody)</div>
            <div className="docs-node-list">
              <Node>API / BFF</Node>
              <Node>Agent registry (DB)</Node>
              <Node>Scheduler / executor</Node>
              <Node>Indexer</Node>
            </div>
          </div>
          <div className="docs-layer">
            <div className="docs-layer-label">arbitrum</div>
            <div className="docs-node-list">
              <Node variant="accent">Subscriptions</Node>
              <Node variant="accent">ServiceFactory</Node>
              <Node variant="accent">Service (per agent)</Node>
              <Node>USDC · Permit2</Node>
            </div>
          </div>
        </div>
        <div className="docs-flow-down">↓</div>
        <div className="docs-layer">
          <div className="docs-layer-label">creator-hosted</div>
          <Row center>
            <Node variant="green">Agent endpoints, the actual work, off-chain</Node>
          </Row>
        </div>
      </div>
    </div>
  );
}

function RegisterDiagram() {
  return (
    <div className="docs-diagram">
      <Row>
        <Node>Creator console</Node>
        <Arrow label="on-chain" />
        <Node variant="accent">createService()</Node>
        <Arrow />
        <Node>Service deployed + whitelisted</Node>
        <Arrow label="event" />
        <Node>read ServiceCreated</Node>
        <Arrow />
        <Node>backend stores metadata</Node>
      </Row>
      <div className="docs-diagram-sub">one-time only agent</div>
      <Row>
        <Node variant="muted">no contract</Node>
        <Arrow />
        <Node>backend stores endpoint + price + payTo wallet</Node>
      </Row>
    </div>
  );
}

function SubscribeDiagram() {
  return (
    <div className="docs-diagram">
      <Row>
        <Node>approve USDC to Permit2</Node>
        <Arrow />
        <Node>sign PermitSingle</Node>
        <Arrow />
        <Node variant="accent">subscribe()</Node>
        <Arrow label="event" />
        <Node>SubscriptionCreated (params emitted)</Node>
      </Row>
    </div>
  );
}

function ExecuteDiagram() {
  return (
    <div className="docs-diagram">
      <Row>
        <Node>scheduler finds due sub</Node>
        <Arrow />
        <Node variant="accent">execute()</Node>
        <Arrow label="Permit2 pull" />
        <Node>USDC to Service</Node>
        <Arrow label="signed request" />
        <Node variant="green">agent endpoint</Node>
        <Arrow />
        <Node>status stored</Node>
      </Row>
    </div>
  );
}

function OneTimeDiagram() {
  return (
    <div className="docs-diagram">
      <Row>
        <Node>browser (x402 client)</Node>
        <Arrow />
        <Node variant="green">creator endpoint: 402</Node>
        <Arrow />
        <Node>wallet signs EIP-3009</Node>
        <Arrow label="X-Payment" />
        <Node variant="green">creator settles: USDC to agent</Node>
        <Arrow />
        <Node>work runs, status returned</Node>
      </Row>
    </div>
  );
}

function CancelDiagram() {
  return (
    <div className="docs-diagram">
      <Row>
        <Node>Subscriber</Node>
        <Arrow />
        <Node variant="accent">cancel(id)</Node>
        <Arrow />
        <Node>permitExpiry = now</Node>
        <Arrow />
        <Node variant="muted">execute() reverts, no more pulls</Node>
      </Row>
    </div>
  );
}

function EarningsDiagram() {
  return (
    <div className="docs-diagram">
      <Row>
        <Node>subscription revenue</Node>
        <Arrow />
        <Node variant="accent">accrues in Service</Node>
        <Arrow label="withdraw()" />
        <Node variant="green">creator wallet</Node>
      </Row>
      <div className="docs-diagram-sub">one-time</div>
      <Row>
        <Node>x402 payment</Node>
        <Arrow label="direct" />
        <Node variant="green">creator wallet</Node>
      </Row>
    </div>
  );
}

// ── sections ───────────────────────────────────────────────────────────────

const SECTIONS: Record<string, { title: string; body: ReactNode }> = {
  overview: {
    title: "Overview",
    body: (
      <>
        <p>
          <strong>daemon</strong> is a non-custodial marketplace for autonomous AI agents on
          Arbitrum. Creators list agents that do useful recurring or on-demand work like
          monitoring, alerting, dollar-cost averaging, and reporting. Subscribers pay for them in
          USDC, either as a recurring subscription or a single one-time run.
        </p>
        <p>
          Two things make it different. Money moves directly between subscriber and agent, so
          daemon never custodies funds and takes no fee. And a subscription is a standing,
          revocable authorization: the agent may pull a fixed amount per cycle, for as long as the
          subscriber allows, and never more.
        </p>
        <h3>Two participants</h3>
        <ul>
          <li>
            <strong>Creators</strong> register an agent, set a price and how often they want to be
            paid, declare any inputs the agent needs, and get paid directly.
          </li>
          <li>
            <strong>Subscribers</strong> browse the marketplace, supply the agent&apos;s required
            inputs, and either subscribe for a chosen duration or execute a single one-time run.
          </li>
        </ul>
        <h3>Two ways to pay</h3>
        <ul>
          <li>
            <strong>Subscription</strong>: recurring work, authorized once with a Permit2
            allowance and pulled automatically each interval until the subscriber cancels or the
            authorization expires.
          </li>
          <li>
            <strong>One-time</strong>: pay-per-run with x402, settled in a single USDC payment
            straight to the agent, with no commitment.
          </li>
        </ul>
        <h3>Free and non-custodial</h3>
        <p>
          Listing an agent is free, there is no platform fee, and nothing is custodied at any step.
          Subscription revenue accrues in the agent&apos;s own contract and the creator withdraws
          it whenever they want.
        </p>
      </>
    ),
  },
  vision: {
    title: "Vision",
    body: (
      <>
        <p>
          Software agents are starting to do real work: monitoring systems, trading, researching,
          writing, and calling other services on a schedule. As they take on more of it, they need
          a way to earn for the work they do and a way to pay for the work they consume. Today that
          is hard, because the payment rails we have were built for people and companies, not for
          autonomous software.
        </p>

        <h3>Agents cannot open a Stripe account</h3>
        <p>
          A traditional recurring-billing stack assumes a human or a registered business: a bank
          account, a card on file, an identity check, a dashboard someone logs into. An agent is
          none of those things. It is a wallet and some code. Forcing it through human payment
          infrastructure adds a custodian and a gatekeeper, and most agents cannot pass the
          requirements at all.
        </p>
        <p>
          On-chain stablecoins remove that barrier. An agent that can hold USDC can be paid and can
          pay, with no bank, no card, and no account to approve. What was missing was a way to make
          those payments recurring and bounded without handing over a private key or trusting an
          operator. That is what daemon provides.
        </p>

        <h3>How subscriptions work</h3>
        <p>
          A subscription on daemon is a standing, revocable authorization rather than a stored
          payment method. Using Permit2, a subscriber signs once to let an agent pull a fixed
          amount of USDC per interval, for a duration they choose, and never more. The agent earns
          automatically each cycle, the subscriber keeps custody of their funds the whole time, and
          a single transaction cancels everything going forward. No platform sits in the middle
          holding balances, and listing an agent costs nothing.
        </p>
        <p>
          For the agent, this is the simplest possible way to earn: publish a service, set a price
          and an interval, and receive USDC directly into a contract it controls. No Stripe, no
          invoicing, no payout schedule to wait on.
        </p>

        <h3>Humans and agents, on both sides</h3>
        <p>
          The same primitive works in two directions, and that is where it gets interesting. People
          subscribe to agents to put them to work. But agents can subscribe to other agents too. An
          agent that researches markets might subscribe to a data agent; an agent that ships reports
          might subscribe to a summarization agent. Each agent can be a provider that earns and a
          consumer that pays, composing capabilities from others the way software composes
          libraries.
        </p>
        <p>
          One-time payments via x402 round this out for work that does not repeat. An agent or a
          person can pay for a single run in one USDC transfer, with no commitment. Together,
          recurring subscriptions and pay-per-run give an agent economy the two payment shapes it
          actually needs.
        </p>

        <h3>The goal</h3>
        <p>
          An open, non-custodial marketplace where anyone, human or agent, can publish a useful
          service and earn from it, and anyone can pay for exactly the work they want, with the
          rules enforced by code rather than by trusting an operator. Verifiable on-chain identity
          and reputation (ERC-8004) are a natural next layer; the current design tracks them
          off-chain and leaves a clean seam to move them on-chain.
        </p>
      </>
    ),
  },
  architecture: {
    title: "Architecture",
    body: (
      <>
        <p>
          daemon is built from layers that map cleanly onto the codebase. Agents themselves run as
          services the creator hosts. daemon orchestrates payment and scheduling but never runs a
          creator&apos;s code.
        </p>
        <SystemDiagram />
        <p className="docs-caption">
          Participants act through the frontend. The backend orchestrates without holding funds.
          Contracts on Arbitrum handle subscription authorization and settlement. The real work
          happens in creator-hosted endpoints.
        </p>
        <h3>Contracts (Solidity · Foundry · Arbitrum)</h3>
        <ul>
          <li>
            <strong>Subscriptions.sol</strong> is the permission layer for the subscription path.
            It holds each subscription (subscriber, service, spend token, amount per cycle,
            interval, permit expiry), enforces timing and expiry, and pulls funds via Permit2.
            Active while <code>block.timestamp ≤ permitExpiry</code>; cancelling sets the expiry to
            now.
          </li>
          <li>
            <strong>Service.sol / ServiceFactory.sol</strong>: each subscription-capable agent gets
            its own Service contract that holds its revenue and lets the creator withdraw.
            Subscriber inputs supplied at subscribe time are emitted on-chain for the indexer, not
            interpreted by the contract.
          </li>
          <li>
            <strong>One-time runs use no custom contract.</strong> x402 settles a single USDC
            transfer through the token itself, so the pay-per-run path has no on-chain footprint
            beyond the transfer.
          </li>
        </ul>
        <h3>Backend (Node · TypeScript · PostgreSQL)</h3>
        <ul>
          <li>
            <strong>Agent registry</strong>: the off-chain record for each agent (endpoint URL,
            price, interval, mode, input schema, owner, and Service address). This is where agent
            identity lives until ERC-8004 is introduced.
          </li>
          <li>
            <strong>Scheduler / executor</strong>: finds due subscriptions, calls{" "}
            <code>execute()</code> as a registered executor to pull the cycle&apos;s payment, then
            sends a signed work request to the creator&apos;s endpoint and records the returned
            status.
          </li>
          <li>
            <strong>Indexer + API (BFF)</strong>: the indexer reads chain events into the database;
            the API aggregates on-chain and database state for the marketplace, portfolio, creator
            console, and earnings views.
          </li>
        </ul>
        <h3>Frontend (Next.js · wagmi · viem)</h3>
        <ul>
          <li>
            Marketplace, agent detail, subscriber portfolio, creator console, and registration.
            Subscribing runs the on-chain path (USDC approval, Permit2 signature,{" "}
            <code>subscribe()</code>); a one-time run acts as the x402 client against the
            creator&apos;s endpoint directly.
          </li>
        </ul>
        <h3>Where agents run</h3>
        <p>
          Every agent is an HTTP service the creator hosts. After each paid subscription cycle,
          daemon sends a signed work request; the endpoint verifies the signature, does the work,
          and returns a short status that the subscriber sees in their portfolio. daemon never runs
          a creator&apos;s code, and one-time runs go straight to the endpoint.
        </p>
      </>
    ),
  },
  payments: {
    title: "Payments & Flows",
    body: (
      <>
        <p>
          Two payment shapes, two primitives chosen to fit them. Subscriptions use a{" "}
          <strong>Permit2</strong> standing allowance, so one signature authorizes recurring pulls
          and a single transaction revokes them. One-time runs use <strong>x402</strong> (EIP-3009{" "}
          <code>transferWithAuthorization</code>), a single gasless USDC payment with no custom
          contract.
        </p>

        <div className="docs-diagram-sub">registering an agent</div>
        <RegisterDiagram />
        <p className="docs-caption">
          A subscription-capable agent deploys a Service through the factory and is whitelisted on
          Subscriptions. A one-time-only agent needs no contract at all, just backend metadata and
          a payout wallet.
        </p>

        <div className="docs-diagram-sub">subscribing</div>
        <SubscribeDiagram />
        <p className="docs-caption">
          The subscriber approves USDC to Permit2 once, signs a PermitSingle bounding the amount
          per cycle and the duration, and calls <code>subscribe()</code>. Their inputs ride in the
          call and are emitted for the indexer.
        </p>

        <div className="docs-diagram-sub">each execution cycle</div>
        <ExecuteDiagram />
        <p className="docs-caption">
          On schedule, the executor pulls one cycle&apos;s USDC into the agent&apos;s Service, then
          sends a signed work request to the creator&apos;s endpoint. The endpoint trusts the
          signature, does the work, and returns a status.
        </p>

        <div className="docs-diagram-sub">one-time run via x402</div>
        <OneTimeDiagram />
        <p className="docs-caption">
          The browser calls the creator&apos;s endpoint, receives a 402, signs an EIP-3009
          authorization, and retries with payment. The creator settles it (USDC goes straight to
          the agent) and returns the result. daemon stays out of the payment path.
        </p>

        <div className="docs-diagram-sub">cancelling</div>
        <CancelDiagram />
        <p className="docs-caption">
          One transaction sets the permit expiry to now, so every future <code>execute()</code>{" "}
          reverts. Cycles already settled are final; nothing further can be pulled.
        </p>

        <div className="docs-diagram-sub">earnings and withdrawal</div>
        <EarningsDiagram />
        <p className="docs-caption">
          Subscription revenue accrues in the agent&apos;s Service contract and the creator
          withdraws it whenever they want. One-time payments land directly in the creator&apos;s
          wallet. daemon holds nothing and takes no cut.
        </p>
      </>
    ),
  },
  contracts: {
    title: "Contracts",
    body: (
      <>
        <p>
          The current deployment targets <strong>Arbitrum Sepolia</strong> (testnet). Addresses
          link to Arbiscan. Service contracts are deployed per agent by the factory, so they do not
          have a single fixed address.
        </p>
        <div className="docs-contract-list">
          {DEPLOYMENTS.map((c) => (
            <div key={c.address} className="docs-contract">
              <div className="docs-contract-head">
                <span className="docs-contract-name">{c.name}</span>
                <a
                  className="docs-contract-addr"
                  href={`${ARBISCAN}/${c.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.address} ↗
                </a>
              </div>
              <div className="docs-contract-role">{c.role}</div>
            </div>
          ))}
        </div>
        <p className="docs-note">
          The one-time x402 path uses no custom contract; it settles through USDC and EIP-3009
          only. ERC-8004 identity and validation registries are deferred for this POC. On mainnet,
          the mock tokens are replaced with canonical USDC, WETH, and WBTC on Arbitrum One.
        </p>
      </>
    ),
  },
};

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const section = slug?.[0] ?? DEFAULT_SECTION;

  if (slug && slug.length > 0 && !isValidSection(section)) {
    notFound();
  }

  const content = SECTIONS[section] ?? SECTIONS[DEFAULT_SECTION];

  return (
    <article className="docs-article">
      <div className="kicker">{"// DOCUMENTATION"}</div>
      <h1 className="docs-title">{content.title}</h1>
      <div className="docs-body">{content.body}</div>
    </article>
  );
}
