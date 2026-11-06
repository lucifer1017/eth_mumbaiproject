"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { parseEventLogs, parseUnits } from "viem";
import { useRegisterAgent } from "@/lib/api/hooks";
import { useApp } from "@/lib/store";
import { getGasFees } from "@/lib/gas";
import {
  AGGREGATOR_ADDRESS,
  CONTRACT_CHAIN,
  DCA_OUTPUT_TOKENS,
  SERVICE_FACTORY_ADDRESS,
  SIP_SERVICE_DEFAULT_FEE_BPS,
  SIP_SERVICE_MAX_FEE_BPS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  billingIntervalSeconds,
  serviceFactoryAbi,
} from "@/lib/contracts";
import type {
  AgentCategory,
  AgentMode,
  BillingInterval,
  Money,
  ParamField,
  RegisterAgentInput,
} from "@/lib/api/types";

type TxPhase = "idle" | "switching" | "wallet" | "deploying";

const PHASE_LABEL: Record<Exclude<TxPhase, "idle">, string> = {
  switching: "switching network…",
  wallet: "confirm in wallet…",
  deploying: "registering on-chain…",
};

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "shortMessage" in e) {
    return String((e as { shortMessage: unknown }).shortMessage);
  }
  return e instanceof Error ? e.message : "couldn’t publish agent";
}

type FieldError =
  | "name"
  | "desc"
  | "endpoint"
  | "services"
  | "subPrice"
  | "oneTimePrice"
  | "icon"
  | "logo"
  | "outputTokens";

interface ParamDraft {
  label: string;
  type: "text" | "number";
  required: boolean;
}

interface RegForm {
  name: string;
  icon: string;
  logo: string;
  cat: AgentCategory;
  desc: string;
  endpoint: string;
  services: string;
  mode: AgentMode;
  subPrice: string;
  oneTimePrice: string;
  freq: BillingInterval;
  params: ParamDraft[];
  isDca: boolean;
  outputTokens: string[];
}

const INITIAL: RegForm = {
  name: "",
  icon: "",
  logo: "",
  cat: "finance",
  desc: "",
  endpoint: "",
  services: "",
  mode: "subscription",
  subPrice: "29",
  oneTimePrice: "1",
  freq: "monthly",
  params: [],
  isDca: false,
  outputTokens: [],
};

const CATEGORIES: { value: AgentCategory; label: string }[] = [
  { value: "finance", label: "Finance" },
  { value: "productivity", label: "Productivity" },
  { value: "career", label: "Career" },
  { value: "engineering", label: "Engineering" },
  { value: "research", label: "Research" },
  { value: "other", label: "Other" },
];

const MODE_OPTS: { key: AgentMode; label: string; hint: string }[] = [
  { key: "subscription", label: "subscription", hint: "Recurring billing" },
  { key: "one_time", label: "one-time", hint: "Pay per run (x402)" },
  { key: "both", label: "both", hint: "Subscription + one-time" },
];

const FREQ_OPTS: { key: BillingInterval; label: string; hint: string }[] = [
  { key: "weekly", label: "weekly", hint: "Paid every 7 days" },
  { key: "monthly", label: "monthly", hint: "Paid every 30 days" },
  { key: "test_5min", label: "every 5 min", hint: "Testing only — paid every 5 minutes" },
  { key: "test_2min", label: "every 2 min", hint: "Testing only — paid every 2 minutes" },
];

function freqUnit(freq: BillingInterval): string {
  if (freq === "weekly") return "wk";
  if (freq === "test_5min") return "5min";
  if (freq === "test_2min") return "2min";
  return "mo";
}

const STEP_LABELS = ["basics", "pricing + inputs", "review"];

function isValidUrl(value: string): boolean {
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}

function paramKey(label: string, i: number): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || `field_${i + 1}`
  );
}

function buildAgentCardURI(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  return `${base}/agents/${slug}-${Date.now().toString(36)}/card.json`;
}

export default function RegisterAgentPage() {
  const router = useRouter();
  const { wallet, openWalletModal, showToast } = useApp();
  const registerMut = useRegisterAgent();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: CONTRACT_CHAIN.id });
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [step, setStep] = useState(1);
  const [reg, setReg] = useState<RegForm>(INITIAL);
  const [errors, setErrors] = useState<Partial<Record<FieldError, string>>>({});

  const publishing = txPhase !== "idle" || registerMut.isPending;
  const hasSub = reg.mode !== "one_time";
  const hasOneTime = reg.mode !== "subscription";

  const patch = (p: Partial<RegForm>) => {
    setReg((r) => ({ ...r, ...p }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(p) as (keyof RegForm)[]) {
        delete next[key as FieldError];
      }
      return next;
    });
  };

  const chips = reg.services
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const cleanParams = reg.params.filter((p) => p.label.trim());

  const validateStep1 = (): Partial<Record<FieldError, string>> => {
    const next: Partial<Record<FieldError, string>> = {};
    if (!reg.name.trim()) next.name = "an agent name is required";
    if (!reg.desc.trim()) next.desc = "a description is required";
    if (!reg.endpoint.trim()) {
      next.endpoint = "an agent endpoint URL is required";
    } else {
      try {
        new URL(reg.endpoint.trim());
      } catch {
        next.endpoint = "must be a valid URL, e.g. https://your-agent.example.com";
      }
    }
    if (reg.icon.trim() && !isValidUrl(reg.icon)) {
      next.icon = "must be a valid image URL";
    }
    if (reg.logo.trim() && !isValidUrl(reg.logo)) {
      next.logo = "must be a valid image URL";
    }
    return next;
  };

  const validateStep2 = (): Partial<Record<FieldError, string>> => {
    const next: Partial<Record<FieldError, string>> = {};
    if (chips.length === 0) next.services = "at least one service tag is required";
    if (hasSub && !(Number(reg.subPrice) > 0)) next.subPrice = "must be greater than 0";
    if (hasOneTime && !(Number(reg.oneTimePrice) > 0)) next.oneTimePrice = "must be greater than 0";
    if (hasSub && reg.isDca && reg.outputTokens.length === 0) {
      next.outputTokens = "select at least one output token";
    }
    return next;
  };

  const toggleOutputToken = (symbol: string) =>
    setReg((r) => ({
      ...r,
      outputTokens: r.outputTokens.includes(symbol)
        ? r.outputTokens.filter((s) => s !== symbol)
        : [...r.outputTokens, symbol],
    }));

  const addParam = () =>
    setReg((r) => ({ ...r, params: [...r.params, { label: "", type: "text", required: true }] }));
  const patchParam = (i: number, p: Partial<ParamDraft>) =>
    setReg((r) => ({
      ...r,
      params: r.params.map((row, idx) => (idx === i ? { ...row, ...p } : row)),
    }));
  const removeParam = (i: number) =>
    setReg((r) => ({ ...r, params: r.params.filter((_, idx) => idx !== i) }));

  const period = freqUnit(reg.freq);
  const priceSummary = [
    hasSub
      ? `${reg.isDca ? "min " : ""}$${reg.subPrice || "0"}/${period}`
      : null,
    hasOneTime ? `$${reg.oneTimePrice || "0"}/run` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const catLabel = CATEGORIES.find((c) => c.value === reg.cat)?.label ?? reg.cat;

  const reviewRows = [
    { k: "NAME", v: reg.name || "-" },
    { k: "ICON", v: reg.icon.trim() || "-" },
    { k: "LOGO", v: reg.logo.trim() || "-" },
    { k: "CATEGORY", v: catLabel },
    { k: "MODE", v: reg.mode.replace("_", " ") },
    ...(hasSub && reg.isDca
      ? [{ k: "OUTPUT TOKENS", v: reg.outputTokens.join(" · ") || "-" }]
      : []),
    { k: "ENDPOINT", v: reg.endpoint || "-" },
    { k: "DESCRIPTION", v: reg.desc || "-" },
    { k: "SERVICES", v: chips.join(" · ") || "-" },
    { k: "PRICING", v: priceSummary || "-" },
    {
      k: "SUBSCRIBER INPUTS",
      v: cleanParams.length ? cleanParams.map((p) => p.label).join(" · ") : "none",
    },
  ];

  const publish = async () => {
    if (!wallet) {
      openWalletModal();
      showToast("connect a wallet to publish");
      return;
    }
    if (!SERVICE_FACTORY_ADDRESS || !USDC_ADDRESS) {
      showToast("contract addresses not configured: set NEXT_PUBLIC_SERVICE_FACTORY_ADDRESS");
      return;
    }
    const isDca = hasSub && reg.isDca;
    if (isDca && !AGGREGATOR_ADDRESS) {
      showToast("contract addresses not configured: set NEXT_PUBLIC_AGGREGATOR_ADDRESS");
      return;
    }
    const step1Errors = validateStep1();
    const step2Errors = validateStep2();
    if (Object.keys(step1Errors).length > 0 || Object.keys(step2Errors).length > 0) {
      setErrors({ ...step1Errors, ...step2Errors });
      setStep(Object.keys(step1Errors).length > 0 ? 1 : 2);
      return;
    }

    const agentCardURI = buildAgentCardURI(reg.name);

    // 1. On-chain registration. Subscription-capable agents deploy a Service
    //    (createService) or, for DCA/swap agents, a SIPService (createSwapService);
    //    one-time-only agents mint identity only (registerAgent). All three
    //    return the ERC-8004 agentId via an event.
    let serviceAddress: string | null = null;
    let onchainAgentId: string;
    try {
      if (chainId !== CONTRACT_CHAIN.id) {
        setTxPhase("switching");
        await switchChainAsync({ chainId: CONTRACT_CHAIN.id });
      }
      if (!publicClient) throw new Error("no RPC client for Arbitrum Sepolia");

      setTxPhase("wallet");
      const gasFees = await getGasFees(publicClient);
      if (isDca) {
        const outputTokenAddrs = DCA_OUTPUT_TOKENS.filter(
          (t) => reg.outputTokens.includes(t.symbol) && t.address,
        ).map((t) => t.address as `0x${string}`);
        const hash = await writeContractAsync({
          abi: serviceFactoryAbi,
          address: SERVICE_FACTORY_ADDRESS,
          functionName: "createSwapService",
          chainId: CONTRACT_CHAIN.id,
          ...gasFees,
          args: [
            wallet.address as `0x${string}`, // feeReceiver: creator's wallet
            USDC_ADDRESS,
            parseUnits(reg.subPrice || "0", USDC_DECIMALS), // minAmountPerCycle
            billingIntervalSeconds(reg.freq),
            agentCardURI,
            BigInt(SIP_SERVICE_MAX_FEE_BPS),
            AGGREGATOR_ADDRESS as `0x${string}`,
            outputTokenAddrs,
            BigInt(SIP_SERVICE_DEFAULT_FEE_BPS),
          ],
        });
        setTxPhase("deploying");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const [created] = parseEventLogs({
          abi: serviceFactoryAbi,
          eventName: "ServiceCreated",
          logs: receipt.logs,
        });
        if (!created) throw new Error("ServiceCreated event not found in receipt");
        serviceAddress = created.args.service;
        onchainAgentId = created.args.agentId.toString();
      } else if (hasSub) {
        const hash = await writeContractAsync({
          abi: serviceFactoryAbi,
          address: SERVICE_FACTORY_ADDRESS,
          functionName: "createService",
          chainId: CONTRACT_CHAIN.id,
          ...gasFees,
          args: [
            wallet.address as `0x${string}`, // feeReceiver: creator's wallet
            USDC_ADDRESS,
            parseUnits(reg.subPrice || "0", USDC_DECIMALS),
            billingIntervalSeconds(reg.freq),
            agentCardURI,
          ],
        });
        setTxPhase("deploying");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const [created] = parseEventLogs({
          abi: serviceFactoryAbi,
          eventName: "ServiceCreated",
          logs: receipt.logs,
        });
        if (!created) throw new Error("ServiceCreated event not found in receipt");
        serviceAddress = created.args.service;
        onchainAgentId = created.args.agentId.toString();
      } else {
        const hash = await writeContractAsync({
          abi: serviceFactoryAbi,
          address: SERVICE_FACTORY_ADDRESS,
          functionName: "registerAgent",
          chainId: CONTRACT_CHAIN.id,
          ...gasFees,
          args: [agentCardURI],
        });
        setTxPhase("deploying");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const [registered] = parseEventLogs({
          abi: serviceFactoryAbi,
          eventName: "AgentRegistered",
          logs: receipt.logs,
        });
        if (!registered) throw new Error("AgentRegistered event not found in receipt");
        onchainAgentId = registered.args.agentId.toString();
      }
    } catch (e) {
      showToast(errorMessage(e));
      return;
    } finally {
      setTxPhase("idle");
    }

    const paramSchema: ParamField[] = cleanParams.map((p, i) => ({
      key: paramKey(p.label, i),
      label: p.label.trim(),
      type: p.type,
      required: p.required,
    }));

    const subPrice: Money | null = hasSub
      ? { amount: reg.subPrice || "0", currency: "USDC" }
      : null;
    const oneTimePrice: Money | null = hasOneTime
      ? { amount: reg.oneTimePrice || "0", currency: "USDC" }
      : null;

    const input: RegisterAgentInput = {
      user_address: wallet.address,
      service_address: serviceAddress,
      onchain_agent_id: onchainAgentId,
      agent_card_uri: agentCardURI,
      endpoint_url: reg.endpoint.trim(),
      mode: reg.mode,
      name: reg.name.trim() || "Untitled agent",
      icon: reg.icon.trim(),
      // Fall back to the icon when no separate logo URL is provided.
      logo: reg.logo.trim() || reg.icon.trim(),
      category: reg.cat,
      description: reg.desc,
      services: chips,
      param_schema: paramSchema,
      sub_price: subPrice,
      payment_frequency: hasSub ? reg.freq : null,
      one_time_price: oneTimePrice,
    };
    registerMut.mutate(input, {
      onSuccess: (data) => {
        setReg(INITIAL);
        setStep(1);
        router.push("/creator");
        showToast(`${data.agent.name} is live in the marketplace`);
      },
      onError: (e) => showToast(errorMessage(e)),
    });
  };

  return (
    <div className="register-wrap">
      <div className="page-head">
        <div className="kicker">{"// REGISTER AGENT"}</div>
        <h1 className="page-title">List your agent</h1>
        <p className="page-sub">Three steps. You can edit everything after publishing.</p>
      </div>

      <div className="steps">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={label} className={`step${active || done ? " on" : ""}${active ? " here" : ""}`}>
              <div className="step-circle">{done ? "✓" : n}</div>
              <div className="step-label">{label}</div>
              {n < 3 && <div className="step-tail" />}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div className="form-stack">
          <div className="field">
            <label className="field-label">AGENT NAME</label>
            <input
              className={`input${errors.name ? " has-error" : ""}`}
              value={reg.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Nightwatch"
            />
            {errors.name && <div className="field-error">{errors.name}</div>}
          </div>
          <div className="field">
            <label className="field-label">
              ICON URL <span className="hint">(square avatar shown on the agent card)</span>
            </label>
            <div className="logo-input-row">
              {reg.icon.trim() && isValidUrl(reg.icon) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="logo-preview" src={reg.icon.trim()} alt="icon preview" />
              ) : (
                <div className="logo-preview empty">{(reg.name.trim()[0] ?? "·").toLowerCase()}</div>
              )}
              <input
                className={`input${errors.icon ? " has-error" : ""}`}
                value={reg.icon}
                onChange={(e) => patch({ icon: e.target.value })}
                placeholder="https://…/icon.png"
              />
            </div>
            {errors.icon && <div className="field-error">{errors.icon}</div>}
          </div>
          <div className="field">
            <label className="field-label">
              LOGO URL <span className="hint">(optional, falls back to the icon)</span>
            </label>
            <input
              className={`input${errors.logo ? " has-error" : ""}`}
              value={reg.logo}
              onChange={(e) => patch({ logo: e.target.value })}
              placeholder="https://…/logo.png"
            />
            {errors.logo && <div className="field-error">{errors.logo}</div>}
          </div>
          <div className="field">
            <label className="field-label">CATEGORY</label>
            <select
              className="input"
              value={reg.cat}
              onChange={(e) => patch({ cat: e.target.value as AgentCategory })}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">
              AGENT ENDPOINT URL <span className="hint">(the HTTP service that does the work)</span>
            </label>
            <input
              className={`input${errors.endpoint ? " has-error" : ""}`}
              value={reg.endpoint}
              onChange={(e) => patch({ endpoint: e.target.value })}
              placeholder="https://your-agent.example.com/run"
            />
            {errors.endpoint && <div className="field-error">{errors.endpoint}</div>}
          </div>
          <div className="field">
            <label className="field-label">
              WHAT DOES IT DO?{" "}
              <span className="hint">(we’ll generate a short card blurb from this)</span>
            </label>
            <textarea
              className={`input${errors.desc ? " has-error" : ""}`}
              rows={4}
              value={reg.desc}
              onChange={(e) => patch({ desc: e.target.value })}
              placeholder="Describe what your agent does, in as much detail as you like."
            />
            {errors.desc && <div className="field-error">{errors.desc}</div>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="form-stack">
          <div className="field">
            <label className="field-label">
              SERVICES OFFERED <span className="hint">(comma-separated)</span>
            </label>
            <input
              className={`input${errors.services ? " has-error" : ""}`}
              value={reg.services}
              onChange={(e) => patch({ services: e.target.value })}
              placeholder="e.g. uptime checks, alerting, weekly report"
            />
            {errors.services && <div className="field-error">{errors.services}</div>}
            {chips.length > 0 && (
              <div className="chip-row reg-chips">
                {chips.map((ch) => (
                  <div key={ch} className="chip">
                    {ch}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label className="field-label">
              HOW DO SUBSCRIBERS PAY? <span className="hint">(subscription, one-time, or both)</span>
            </label>
            <div className="model-grid">
              {MODE_OPTS.map((m) => (
                <button
                  key={m.key}
                  className={`model-opt${reg.mode === m.key ? " on" : ""}`}
                  onClick={() => patch({ mode: m.key })}
                >
                  <div className="model-opt-label">{m.label}</div>
                  <div className="model-opt-hint">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {hasSub && (
            <div className="field">
              <label className="field-label">
                AGENT TYPE <span className="hint">(what the subscription pays for)</span>
              </label>
              <div className="model-grid">
                <button
                  className={`model-opt${!reg.isDca ? " on" : ""}`}
                  onClick={() => patch({ isDca: false })}
                >
                  <div className="model-opt-label">fixed service</div>
                  <div className="model-opt-hint">Charges a fixed amount each cycle</div>
                </button>
                <button
                  className={`model-opt${reg.isDca ? " on" : ""}`}
                  onClick={() => patch({ isDca: true })}
                >
                  <div className="model-opt-label">DCA / token swap</div>
                  <div className="model-opt-hint">
                    Each cycle, swaps the subscriber&apos;s spend into a chosen token and sends it
                    to them
                  </div>
                </button>
              </div>
            </div>
          )}

          {hasSub && reg.isDca && (
            <div className="field">
              <label className="field-label">
                OUTPUT TOKENS <span className="hint">(tokens this agent can swap into)</span>
              </label>
              <div className="model-grid">
                {DCA_OUTPUT_TOKENS.map((t) => (
                  <button
                    key={t.symbol}
                    className={`model-opt${reg.outputTokens.includes(t.symbol) ? " on" : ""}`}
                    onClick={() => toggleOutputToken(t.symbol)}
                    disabled={!t.address}
                  >
                    <div className="model-opt-label">{t.symbol}</div>
                    <div className="model-opt-hint">{t.address ?? "not configured"}</div>
                  </button>
                ))}
              </div>
              {errors.outputTokens && <div className="field-error">{errors.outputTokens}</div>}
            </div>
          )}

          {hasSub && (
            <div className="field">
              <label className="field-label">
                PAYMENT FREQUENCY <span className="hint">(how often the agent gets paid)</span>
              </label>
              <div className="model-grid">
                {FREQ_OPTS.map((f) => (
                  <button
                    key={f.key}
                    className={`model-opt${reg.freq === f.key ? " on" : ""}`}
                    onClick={() => patch({ freq: f.key })}
                  >
                    <div className="model-opt-label">{f.label}</div>
                    <div className="model-opt-hint">{f.hint}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="price-grid">
            {hasSub && (
              <div className="field">
                <label className="field-label">
                  {reg.isDca
                    ? `MINIMUM SPEND PER CYCLE ($/${freqUnit(reg.freq).toUpperCase()})`
                    : `SUBSCRIPTION PRICE ($/${freqUnit(reg.freq).toUpperCase()})`}
                </label>
                <input
                  className={`input mono-input${errors.subPrice ? " has-error" : ""}`}
                  value={reg.subPrice}
                  onChange={(e) => patch({ subPrice: e.target.value })}
                />
                {errors.subPrice && <div className="field-error">{errors.subPrice}</div>}
              </div>
            )}
            {hasOneTime && (
              <div className="field">
                <label className="field-label">ONE-TIME PRICE ($/RUN)</label>
                <input
                  className={`input mono-input${errors.oneTimePrice ? " has-error" : ""}`}
                  value={reg.oneTimePrice}
                  onChange={(e) => patch({ oneTimePrice: e.target.value })}
                />
                {errors.oneTimePrice && <div className="field-error">{errors.oneTimePrice}</div>}
              </div>
            )}
          </div>

          <div className="field">
            <label className="field-label">
              SUBSCRIBER INPUTS{" "}
              <span className="hint">(info your agent needs from each subscriber)</span>
            </label>
            <div className="param-editor">
              {reg.params.length === 0 && (
                <div className="param-empty">
                  No inputs required. Add a field if your agent needs something from the subscriber
                  (e.g. a wallet to monitor, a ticker, an email).
                </div>
              )}
              {reg.params.map((p, i) => (
                <div key={i} className="param-row">
                  <input
                    className="input param-label-input"
                    value={p.label}
                    onChange={(e) => patchParam(i, { label: e.target.value })}
                    placeholder="Field label, e.g. Wallet to watch"
                  />
                  <select
                    className="input param-type-input"
                    value={p.type}
                    onChange={(e) => patchParam(i, { type: e.target.value as "text" | "number" })}
                  >
                    <option value="text">text</option>
                    <option value="number">number</option>
                  </select>
                  <label className="param-req">
                    <input
                      type="checkbox"
                      checked={p.required}
                      onChange={(e) => patchParam(i, { required: e.target.checked })}
                    />
                    required
                  </label>
                  <button
                    className="param-remove"
                    onClick={() => removeParam(i)}
                    aria-label="remove field"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button className="btn-ghost param-add" onClick={addParam}>
                + add input field
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="review-card">
          {reviewRows.map((row) => (
            <div key={row.k} className="review-row">
              <div className="review-key">{row.k}</div>
              <div className="review-val">{row.v}</div>
            </div>
          ))}
          <div className="review-note">
            Publishing deploys your agent on-chain and lists it in the marketplace. There is no
            platform fee, and you withdraw your earnings anytime.
          </div>
        </div>
      )}

      <div className="reg-actions">
        {step > 1 && (
          <button className="btn-back" onClick={() => setStep(step - 1)} disabled={publishing}>
            ← back
          </button>
        )}
        <button
          className="btn-next"
          disabled={publishing}
          onClick={() => {
            if (step === 3) {
              publish();
              return;
            }
            const stepErrors = step === 1 ? validateStep1() : validateStep2();
            if (Object.keys(stepErrors).length > 0) {
              setErrors(stepErrors);
              return;
            }
            setStep(step + 1);
          }}
        >
          {step === 3
            ? txPhase !== "idle"
              ? PHASE_LABEL[txPhase]
              : registerMut.isPending
                ? "publishing…"
                : "publish agent →"
            : "continue →"}
        </button>
      </div>
    </div>
  );
}
