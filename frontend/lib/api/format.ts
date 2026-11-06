import type { Money } from "./types";

/** Render a Money object as a UI string, e.g. `$19`, `$12.00`, `$4,230`. */
export function formatMoney(
  money: Money | null | undefined,
  opts?: { cents?: boolean },
): string {
  if (!money || money.amount == null) return opts?.cents ? "$0.00" : "$0";
  const n = Number(money.amount);
  const isCurrencyDollar = money.currency === "USDC" || money.currency === "USD";
  const showCents = opts?.cents ?? !Number.isInteger(n);
  const body = n.toLocaleString("en-US", {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
  return isCurrencyDollar ? `$${body}` : `${body} ${money.currency}`;
}

/** Render a non-stablecoin token amount, e.g. `0.003142 WETH` (full precision matters at small sizes). */
export function formatTokenAmount(money: Money | null | undefined): string {
  if (!money || money.amount == null) return "-";
  const n = Number(money.amount);
  const body = n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  return `${body} ${money.currency}`;
}

/** Per-run usage line for a plan, e.g. `+ $0.50 / application`. */
export function formatMeter(usagePrice: Money | null, usageUnit: string | null): string {
  if (!usagePrice || !usageUnit) return "";
  return `+ ${formatMoney(usagePrice, { cents: true })} / ${usageUnit}`;
}

/** Format an ISO timestamp as `Jul 1, 2026`. */
export function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Format an ISO month string `2026-06` as `jun`. */
export function formatMonth(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toLowerCase();
}

/** Two-letter monogram from an agent name, e.g. `Pulse` -> `pu`. */
export function monogram(name: string): string {
  return name.trim().slice(0, 2).toLowerCase() || "··";
}
