"use client";

import { useCreatorEarnings } from "@/lib/api/hooks";
import { formatDate, formatMoney, formatMonth } from "@/lib/api/format";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useApp } from "@/lib/store";
import { useWithdraw } from "@/lib/useWithdraw";

function compactMoney(amount: string): string {
  const n = Number(amount);
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
}

export default function EarningsPage() {
  const { wallet, openWalletModal, showToast } = useApp();
  const { data, isLoading, isError, error, refetch } = useCreatorEarnings(wallet?.address);
  const { withdraw, isWithdrawing } = useWithdraw();

  const handleWithdraw = async (serviceAddress: string) => {
    try {
      await withdraw(serviceAddress as `0x${string}`);
      showToast("withdrawal sent");
      refetch();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "withdraw failed");
    }
  };

  const head = (
    <div className="page-head">
      <div className="kicker">{"// EARNINGS"}</div>
      <h1 className="page-title">Revenue &amp; withdrawals</h1>
      <p className="page-sub">
        Earnings accrue in each agent&apos;s Service contract. Withdraw anytime. No platform fee.
      </p>
    </div>
  );

  if (!wallet) {
    return (
      <div>
        {head}
        <EmptyState title="No wallet connected" sub="Connect to see your earnings.">
          <button className="btn-primary" onClick={openWalletModal}>
            connect wallet
          </button>
        </EmptyState>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        {head}
        <LoadingState label="loading earnings…" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        {head}
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const { stats, revenue_by_month, withdrawals, earnings_by_agent } = data;
  const maxRev = Math.max(...revenue_by_month.map((d) => Number(d.amount.amount)), 1);

  const statCards = [
    {
      k: "MRR",
      v: formatMoney(stats.monthly_recurring_revenue),
      sub: "monthly recurring",
      up: true,
    },
    {
      k: "ACTIVE SUBSCRIBERS",
      v: stats.active_subscribers.toLocaleString("en-US"),
      sub: `+${stats.subscriber_change} this month`,
      up: true,
    },
    {
      k: "WITHDRAWABLE NOW",
      v: formatMoney(stats.withdrawable_balance),
      sub: "in your contracts",
      up: false,
    },
    {
      k: "LIFETIME REVENUE",
      v: formatMoney(stats.lifetime_revenue),
      sub: `${formatMoney(stats.total_withdrawn)} withdrawn`,
      up: false,
    },
  ];

  return (
    <div>
      {head}

      <div className="stats-grid">
        {statCards.map((stat) => (
          <div key={stat.k} className="stat-card">
            <div className="stat-key">{stat.k}</div>
            <div className="stat-val">{stat.v}</div>
            <div className={`stat-sub${stat.up ? " up" : ""}`}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <div className="earnings-grid">
        <div className="panel">
          <div className="section-label chart">
            REVENUE · LAST {revenue_by_month.length} MONTHS
          </div>
          <div className="bars">
            {revenue_by_month.map((d, i) => (
              <div key={d.month} className="bar-col">
                <div className="bar-amt">{compactMoney(d.amount.amount)}</div>
                <div
                  className={`bar${i === revenue_by_month.length - 1 ? " hot" : ""}`}
                  style={{ height: `${Math.round((Number(d.amount.amount) / maxRev) * 100)}%` }}
                />
                <div className="bar-month">{formatMonth(d.month)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="earnings-side">
          <div className="panel">
            <div className="section-label">RECENT WITHDRAWALS</div>
            <div className="payout-list">
              {withdrawals.length === 0 && (
                <div className="billing-note">No withdrawals yet.</div>
              )}
              {withdrawals.map((w) => (
                <div key={w.withdrawal_id} className="payout-row">
                  <div className="payout-date">{formatDate(w.withdrawn_at)}</div>
                  <div className="payout-amt">{formatMoney(w.amount, { cents: true })}</div>
                  <div className="pill ok">withdrawn</div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="section-label">BY AGENT</div>
            <div className="byagent-list">
              {earnings_by_agent.map((ae) => (
                <div key={ae.agent_id} className="byagent-row">
                  <div className="byagent-name">{ae.agent_name}</div>
                  <div className="byagent-subs">{ae.subscriber_count} subscribers</div>
                  <div className="byagent-mrr">
                    {ae.subscriber_count > 0
                      ? `${formatMoney(ae.monthly_recurring_revenue)}/mo`
                      : `${formatMoney(ae.lifetime_revenue)} total`}
                  </div>
                  {ae.service_address && (
                    <button
                      className="btn-ghost"
                      disabled={isWithdrawing}
                      onClick={() => handleWithdraw(ae.service_address!)}
                    >
                      {isWithdrawing ? "withdrawing…" : "withdraw"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
