"use client";

import { useRouter } from "next/navigation";
import { useUserRuns, useUserSubscriptions } from "@/lib/api/hooks";
import { formatDate, formatMoney, formatTokenAmount } from "@/lib/api/format";
import Avatar from "@/components/Avatar";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useApp } from "@/lib/store";

export default function SubscriptionsPage() {
  const router = useRouter();
  const { wallet, openWalletModal, cancelSub, cancellingId } = useApp();
  const address = wallet?.address;

  const subsQuery = useUserSubscriptions(address);
  const runsQuery = useUserRuns(address);

  if (!wallet) {
    return (
      <div>
        <div className="page-head">
          <div className="kicker">{"// MY SUBSCRIPTIONS"}</div>
          <h1 className="page-title">Your agents</h1>
          <p className="page-sub">Connect a wallet to see your subscriptions and activity.</p>
        </div>
        <EmptyState title="No wallet connected" sub="Connect to view the agents you’ve put to work.">
          <button className="btn-primary" onClick={openWalletModal}>
            connect wallet
          </button>
        </EmptyState>
      </div>
    );
  }

  const subs = subsQuery.data?.subscriptions ?? [];
  const summary = subsQuery.data?.summary;
  const runs = runsQuery.data?.runs ?? [];
  const totalSpent = runsQuery.data?.summary?.total_spent;

  return (
    <div>
      <div className="page-head">
        <div className="kicker">{"// MY SUBSCRIPTIONS"}</div>
        <h1 className="page-title">Your agents</h1>
        <p className="page-sub">
          {summary
            ? `${summary.active_count} active ${
                summary.active_count === 1 ? "subscription" : "subscriptions"
              } · ${formatMoney(summary.monthly_total)}/mo`
            : "-"}
        </p>
      </div>

      {subsQuery.isLoading && <LoadingState label="loading subscriptions…" />}
      {subsQuery.isError && (
        <ErrorState error={subsQuery.error} onRetry={() => subsQuery.refetch()} />
      )}
      {!subsQuery.isLoading && !subsQuery.isError && subs.length === 0 && (
        <EmptyState
          title="No active subscriptions"
          sub="Browse the marketplace to put an agent to work."
        >
          <button className="btn-primary" onClick={() => router.push("/")}>
            browse marketplace
          </button>
        </EmptyState>
      )}

      {subs.length > 0 && (
        <div className="row-stack subs">
          {subs.map((s) => {
            const price = s.next_payment_amount ?? s.last_payment_amount;
            const period =
              s.billing_interval === "weekly"
                ? "wk"
                : s.billing_interval === "test_5min"
                  ? "5min"
                  : s.billing_interval === "test_2min"
                    ? "2min"
                    : "mo";
            return (
              <div key={s.id} className="row-card">
                <Avatar name={s.agent} logo={s.logo} />
                <div className="row-id">
                  <div className="row-title">{s.agent}</div>
                  <div className="row-sub">{s.billing_interval}</div>
                </div>
                <div className="active-tag">
                  <div className="dot sm" />
                  {s.status}
                </div>
                <div className="spacer" />
                {price && (
                  <div className="row-price">
                    {formatMoney(price, { cents: false })}
                    <span className="price-unit">/{period}</span>
                  </div>
                )}
                <button
                  className="btn-ghost"
                  onClick={() => router.push(`/agents/${s.agent_id}`)}
                >
                  manage
                </button>
                {s.status === "active" && (
                  <button
                    className="btn-quiet"
                    disabled={cancellingId === s.id}
                    onClick={() => cancelSub(s.id, s.onchain_sub_id, s.agent)}
                  >
                    {cancellingId === s.id ? "cancelling…" : "cancel"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="billing-grid">
        <div className="billing-card">
          <div className="section-label">PAYMENT · WALLET</div>
          <div className="wallet-line">
            <div className="dot" />
            <div className="wallet-addr">{wallet.addr}</div>
          </div>
          <div className="billing-note balance">
            total spent ·{" "}
            <span className="strong">
              {totalSpent ? formatMoney(totalSpent, { cents: true }) : "$0.00"}
            </span>
          </div>
          <div className="billing-note">
            Subscriptions pull USDC directly from your wallet each cycle. Nothing is custodied.
          </div>
        </div>

        <div className="billing-card">
          <div className="section-label">ACTIVITY</div>
          {runsQuery.isLoading && <div className="billing-note">loading activity…</div>}
          {runsQuery.isError && <div className="billing-note">Couldn’t load activity.</div>}
          {!runsQuery.isLoading && !runsQuery.isError && runs.length === 0 && (
            <div className="billing-note">No runs yet.</div>
          )}
          {runs.length > 0 && (
            <div className="invoice-list">
              {runs.map((r) => (
                <div key={r.run_id} className="invoice-row">
                  <div className="invoice-date">{formatDate(r.ran_at)}</div>
                  <div className="invoice-desc">
                    {r.agent}
                    {r.status_message ? ` · ${r.status_message}` : ""}
                    {r.received ? ` · received ${formatTokenAmount(r.received)}` : ""}
                  </div>
                  <div className="invoice-amt">{formatMoney(r.amount, { cents: true })}</div>
                  <div className={`pill${r.success ? " ok" : ""}`}>{r.kind}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
