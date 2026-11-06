import type { ReactNode } from "react";
import { ApiError } from "@/lib/api/client";

export function LoadingState({ label = "loading…" }: { label?: string }) {
  return (
    <div className="state-block">
      <div className="spinner" />
      <div className="state-text">{label}</div>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Something went wrong";
  const isConfig = error instanceof ApiError && error.code === "config";

  return (
    <div className="empty-state">
      <div className="empty-title">{isConfig ? "Backend not configured" : "Couldn’t load this"}</div>
      <div className="empty-sub">{message}</div>
      {onRetry && (
        <button className="btn-primary" onClick={onRetry}>
          try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
      {children}
    </div>
  );
}
