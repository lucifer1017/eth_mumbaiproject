"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/api/format";
import { billingIntervalSeconds } from "@/lib/contracts";
import { useApp, type Role } from "@/lib/store";

function OnboardModal() {
  const { onboardOpen, onboardPending, wallet, finishOnboard } = useApp();
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<Role>("sub");

  if (!onboardOpen) return null;

  const roleOpts: { key: Role; label: string; hint: string }[] = [
    { key: "sub", label: "subscribe", hint: "Put agents to work" },
    { key: "cre", label: "create", hint: "List & earn from agents" },
  ];

  return (
    <div className="overlay deep">
      <div className="modal onboard">
        <div className="kicker">{"// WELCOME TO DAEMON"}</div>
        <div className="modal-title tight">Set up your account</div>
        <div className="connected-line">
          <div className="dot" />
          connected · {wallet?.addr}
        </div>

        <div className="field ob-field">
          <label className="field-label">HANDLE</label>
          <input
            className="ob-input"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@yourname"
          />
        </div>

        <div className="field ob-field roles">
          <label className="field-label">I&apos;M HERE TO…</label>
          <div className="ob-roles">
            {roleOpts.map((o) => (
              <button
                key={o.key}
                className={`ob-role${role === o.key ? " on" : ""}`}
                onClick={() => setRole(o.key)}
              >
                <div className="ob-role-label">{o.label}</div>
                <div className="ob-role-hint">{o.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <button
          className="btn-enter"
          disabled={onboardPending}
          onClick={() => finishOnboard(handle, role)}
        >
          {onboardPending ? "linking…" : "enter daemon →"}
        </button>
      </div>
    </div>
  );
}

type SubMode = "subscribe" | "one_time";

const DURATION_OPTS: { months: number; label: string }[] = [
  { months: 1, label: "1 month" },
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "12 months" },
];

// Short-lived durations for the fast testing intervals (every 5 / 2 min), so a
// few execution cycles happen without needing a year-long permit window.
const TEST_DURATION_OPTS: { hours: number; label: string }[] = [
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" },
];

const MONTH_SECONDS = 30 * 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;

function SubscribeModal() {
  const {
    pendingSub,
    subscribePending,
    subscribePhase,
    wallet,
    closeSubModal,
    confirmSubscribe,
    runOneTime,
    oneTimeOutput,
    oneTimePending,
  } = useApp();

  const [mode, setMode] = useState<SubMode>("subscribe");
  const [months, setMonths] = useState(3);
  const [testHours, setTestHours] = useState(1);
  const [params, setParams] = useState<Record<string, string>>({});

  const agentKey = pendingSub?.agentId ?? null;
  const canSubscribe = !!(pendingSub?.subPrice && pendingSub?.serviceAddress);
  const canOneTime = !!pendingSub?.oneTimePrice;
  const isTestInterval =
    pendingSub?.billingInterval === "test_5min" ||
    pendingSub?.billingInterval === "test_2min";

  // Reset and default to whichever mode the agent supports.
  useEffect(() => {
    setMode(canSubscribe ? "subscribe" : "one_time");
    setMonths(3);
    setTestHours(1);
    setParams({});
  }, [agentKey, canSubscribe]);

  const schema = pendingSub?.paramSchema ?? [];
  const intervalSecs = pendingSub
    ? billingIntervalSeconds(pendingSub.billingInterval)
    : MONTH_SECONDS;
  const durationSecs = isTestInterval ? testHours * HOUR_SECONDS : months * MONTH_SECONDS;
  const estimatedPayments = useMemo(
    () => Math.max(1, Math.floor(durationSecs / intervalSecs)),
    [durationSecs, intervalSecs],
  );

  if (!pendingSub) return null;

  const subPriceLabel = pendingSub.subPrice ? formatMoney(pendingSub.subPrice) : "";
  const oneTimeLabel = pendingSub.oneTimePrice ? formatMoney(pendingSub.oneTimePrice) : "";
  const period =
    pendingSub.billingInterval === "weekly"
      ? "wk"
      : pendingSub.billingInterval === "test_5min"
        ? "5min"
        : pendingSub.billingInterval === "test_2min"
          ? "2min"
          : "mo";
  const payMethod = wallet ? `usdc · ${wallet.addr}` : "usdc · wallet";
  const busy = subscribePending || oneTimePending;

  const missingRequired = schema
    .filter((f) => f.required)
    .some((f) => !(params[f.key] ?? "").trim());

  const setParam = (key: string, value: string) =>
    setParams((p) => ({ ...p, [key]: value }));

  const paramFields =
    schema.length > 0 ? (
      <div className="sub-params">
        <div className="sub-params-label">
          {"// "}
          {mode === "subscribe" ? "AGENT NEEDS FROM YOU" : "INPUTS FOR THIS RUN"}
        </div>
        {schema.map((f) => (
          <div key={f.key} className="field sub-param-field">
            <label className="field-label">
              {f.label}
              {f.required && <span className="req-star"> *</span>}
            </label>
            <input
              className="input"
              type={f.type === "number" ? "number" : "text"}
              value={params[f.key] ?? ""}
              placeholder={f.placeholder ?? ""}
              onChange={(e) => setParam(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>
    ) : null;

  // One-time completed → show the agent's output.
  if (mode === "one_time" && oneTimeOutput) {
    return (
      <div className="overlay" onClick={closeSubModal}>
        <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
          <div className="kicker">{"// ONE-TIME RESULT"}</div>
          <div className="modal-title roomy">{pendingSub.agentName}</div>
          <div className="onetime-output">
            {oneTimeOutput.output?.summary && (
              <div className="onetime-summary">{oneTimeOutput.output.summary}</div>
            )}
            {oneTimeOutput.output?.result && (
              <div className="onetime-result">{oneTimeOutput.output.result}</div>
            )}
            <pre className="onetime-raw">{JSON.stringify(oneTimeOutput.output, null, 2)}</pre>
            {oneTimeOutput.receipt && (
              <div className="confirm-row">
                <span className="k">receipt</span>
                <span className="meter">{oneTimeOutput.receipt.tx_hash}</span>
              </div>
            )}
          </div>
          <div className="confirm-actions">
            <button className="btn-confirm" onClick={closeSubModal}>
              done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={busy ? undefined : closeSubModal}>
      <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
        <div className="kicker">{"// USE THIS AGENT"}</div>
        <div className="modal-title roomy">{pendingSub.agentName}</div>

        {canSubscribe && canOneTime && (
          <div className="mode-tabs">
            <button
              className={`mode-tab${mode === "subscribe" ? " on" : ""}`}
              onClick={() => setMode("subscribe")}
              disabled={busy}
            >
              <div className="mode-tab-label">subscribe</div>
              <div className="mode-tab-hint">recurring, for a set time</div>
            </button>
            <button
              className={`mode-tab${mode === "one_time" ? " on" : ""}`}
              onClick={() => setMode("one_time")}
              disabled={busy}
            >
              <div className="mode-tab-label">one-time</div>
              <div className="mode-tab-hint">run once, get the output</div>
            </button>
          </div>
        )}

        {mode === "subscribe" && canSubscribe && (
          <>
            <div className="field">
              <label className="field-label">HOW LONG?</label>
              <div className="duration-grid">
                {isTestInterval
                  ? TEST_DURATION_OPTS.map((d) => (
                      <button
                        key={d.hours}
                        className={`duration-opt${testHours === d.hours ? " on" : ""}`}
                        onClick={() => setTestHours(d.hours)}
                        disabled={busy}
                      >
                        {d.label}
                      </button>
                    ))
                  : DURATION_OPTS.map((d) => (
                      <button
                        key={d.months}
                        className={`duration-opt${months === d.months ? " on" : ""}`}
                        onClick={() => setMonths(d.months)}
                        disabled={busy}
                      >
                        {d.label}
                      </button>
                    ))}
              </div>
            </div>

            {paramFields}

            <div className="confirm-rows">
              <div className="confirm-row">
                <span className="k">price</span>
                <span>
                  {subPriceLabel}/{period}
                </span>
              </div>
              <div className="confirm-row">
                <span className="k">duration</span>
                <span>
                  {isTestInterval
                    ? `${testHours} hour${testHours > 1 ? "s" : ""}`
                    : `${months} month${months > 1 ? "s" : ""}`}{" "}
                  · ~{estimatedPayments} payment
                  {estimatedPayments > 1 ? "s" : ""}
                </span>
              </div>
              <div className="confirm-row">
                <span className="k">payment</span>
                <span>{payMethod}</span>
              </div>
            </div>

            <div className="confirm-actions">
              <button className="btn-cancel" onClick={closeSubModal} disabled={busy}>
                cancel
              </button>
              <button
                className="btn-confirm"
                disabled={busy || missingRequired}
                onClick={() => confirmSubscribe(durationSecs, params)}
              >
                {subscribePhase ?? `confirm · ${subPriceLabel}/${period}`}
              </button>
            </div>
          </>
        )}

        {mode === "one_time" && canOneTime && (
          <>
            {paramFields}
            <div className="confirm-rows">
              <div className="confirm-row">
                <span className="k">one-time fee</span>
                <span>{oneTimeLabel}</span>
              </div>
              <div className="confirm-row">
                <span className="k">runs</span>
                <span>once · output returned below</span>
              </div>
              <div className="confirm-row">
                <span className="k">payment</span>
                <span>{payMethod}</span>
              </div>
            </div>
            <div className="confirm-actions">
              <button className="btn-cancel" onClick={closeSubModal} disabled={busy}>
                cancel
              </button>
              <button
                className="btn-confirm"
                disabled={busy || missingRequired}
                onClick={() => runOneTime(params)}
              >
                {oneTimePending ? "running…" : `run once · ${oneTimeLabel}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}

export default function Modals() {
  return (
    <>
      <OnboardModal />
      <SubscribeModal />
      <Toast />
    </>
  );
}
