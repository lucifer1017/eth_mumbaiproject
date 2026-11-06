"use client";

import { useParams, useRouter } from "next/navigation";
import { useAgent, useUserSubscriptions } from "@/lib/api/hooks";
import { formatMoney } from "@/lib/api/format";
import Avatar from "@/components/Avatar";
import { ErrorState, LoadingState } from "@/components/States";
import { useApp } from "@/lib/store";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { wallet, requestSubscribe } = useApp();
  const { data, isLoading, isError, error, refetch } = useAgent(id);
  const { data: subsData } = useUserSubscriptions(wallet?.address);

  const back = (
    <button className="back-link" onClick={() => router.push("/")}>
      ← marketplace
    </button>
  );

  if (isLoading) {
    return (
      <div>
        {back}
        <LoadingState label="loading agent…" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        {back}
        <ErrorState error={error ?? new Error("Agent not found")} onRetry={() => refetch()} />
      </div>
    );
  }

  const agent = data.agent;
  const alreadySubscribed = (subsData?.subscriptions ?? []).some(
    (s) => s.agent_id === agent.agent_id && s.status === "active",
  );

  const canSubscribe =
    agent.mode !== "one_time" && !!agent.sub_price && !!agent.service_address;
  const canOneTime = agent.mode !== "subscription" && !!agent.one_time_price;
  const period =
    agent.payment_frequency === "weekly"
      ? "wk"
      : agent.payment_frequency === "test_5min"
        ? "5min"
        : agent.payment_frequency === "test_2min"
          ? "2min"
          : "mo";

  const openModal = () =>
    requestSubscribe({
      agentId: agent.agent_id,
      agentName: agent.name,
      mode: agent.mode,
      serviceAddress: agent.service_address,
      billingInterval: agent.payment_frequency ?? "monthly",
      subPrice: agent.sub_price,
      oneTimePrice: agent.one_time_price,
      paramSchema: agent.param_schema ?? [],
    });

  return (
    <div>
      {back}

      <div className="detail-head">
        <Avatar name={agent.name} logo={agent.logo} size="lg" />
        <div>
          <h1 className="detail-title">{agent.name}</h1>
          <div className="detail-meta">
            ★ {agent.rating} · trust {agent.trust_score} · {agent.subscriber_count} subscribers ·
            by {agent.publisher_name}
          </div>
        </div>
        <div className="pricing-badge">{agent.mode.replace("_", " ")}</div>
      </div>

      <p className="long-desc">{agent.description}</p>

      <div className="chip-row detail-chips">
        {agent.services.map((s) => (
          <div key={s} className="chip">
            {s}
          </div>
        ))}
      </div>

      <div className="kicker plans-label">{"// PRICING · SET BY CREATOR"}</div>
      <div className="plans-grid">
        {canSubscribe && agent.sub_price && (
          <div className={`plan-card${alreadySubscribed ? " current" : ""}`}>
            <div className="plan-name">subscription</div>
            <div className="plan-price-row">
              <div className="plan-price">{formatMoney(agent.sub_price, { cents: false })}</div>
              <div className="plan-price-unit">/{period}</div>
            </div>
            <div className="plan-detail">
              Recurring, billed every {agent.payment_frequency}. Cancel anytime.
            </div>
            <button
              className={`plan-btn${alreadySubscribed ? " current" : ""}`}
              onClick={alreadySubscribed ? undefined : openModal}
            >
              {alreadySubscribed ? "subscribed" : "subscribe"}
            </button>
          </div>
        )}

        {canOneTime && agent.one_time_price && (
          <div className="plan-card">
            <div className="plan-name">one-time</div>
            <div className="plan-price-row">
              <div className="plan-price">
                {formatMoney(agent.one_time_price, { cents: false })}
              </div>
              <div className="plan-price-unit">/run</div>
            </div>
            <div className="plan-detail">Run once and get the output. No commitment.</div>
            <button className="plan-btn" onClick={openModal}>
              run once
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
