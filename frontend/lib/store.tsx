"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { parseUnits, stringToHex } from "viem";
import { shortenAddress } from "./wagmi";
import { ApiError } from "./api/client";
import {
  useCancelSubscription,
  useInvokeAgent,
  useOnboard,
  usePlatformConfig,
  useSubscribe,
} from "./api/hooks";
import { type InvokeAgentDetails } from "./api/endpoints";
import { USDC_DECIMALS, billingIntervalSeconds } from "./contracts";
import {
  CANCEL_PHASE_LABEL,
  SUBSCRIBE_PHASE_LABEL,
  useCancelOnChain,
  useOneTimePermit,
  useSubscribeOnChain,
} from "./useSubscribeOnChain";
import type { AgentMode, BillingInterval, Money, ParamField } from "./api/types";

export type Role = "sub" | "cre";

export interface Wallet {
  /** Truncated display form, e.g. `0x7A3f…C9f2`. */
  addr: string;
  /** Full checksummed address. */
  address: string;
  /** Connector name, e.g. "MetaMask". */
  name: string;
}

export interface PendingSub {
  agentId: string;
  agentName: string;
  mode: AgentMode;
  /** Agent's Service contract, target of the on-chain subscribe (null for one-time only). */
  serviceAddress: string | null;
  billingInterval: BillingInterval;
  /** Subscription price per cycle; null unless subscription/both. */
  subPrice: Money | null;
  /** x402 price per run; null unless one_time/both. */
  oneTimePrice: Money | null;
  /** Inputs the agent requires from the subscriber. */
  paramSchema: ParamField[];
}

interface AppState {
  wallet: Wallet | null;
  onboardOpen: boolean;
  onboardPending: boolean;
  toast: string;
  pendingSub: PendingSub | null;
  subscribePending: boolean;
  /** Progress label while the on-chain + backend subscribe flow runs. */
  subscribePhase: string | null;
  /** Output of a one-time invocation, shown in the modal once it completes. */
  oneTimeOutput: InvokeAgentDetails | null;
  oneTimePending: boolean;
  openWalletModal: () => void;
  disconnectWallet: () => void;
  finishOnboard: (handle: string, role: Role) => void;
  requestSubscribe: (sub: PendingSub) => void;
  closeSubModal: () => void;
  /** Recurring subscription: on-chain subscribe (duration-bounded) + backend record. */
  confirmSubscribe: (durationSeconds: number, paramValues: Record<string, string>) => void;
  /** One-time execution via the agent's invoke endpoint. */
  runOneTime: (paramValues: Record<string, string>) => void;
  /** On-chain Subscriptions.cancel(onchainSubId) + backend record. */
  cancelSub: (subscriptionId: string, onchainSubId: string, agentName: string) => void;
  /** The subscription id currently being cancelled (for per-row UI), or null. */
  cancellingId: string | null;
  showToast: (msg: string) => void;
}

const AppContext = createContext<AppState | null>(null);

const onboardedKey = (address: string) => `daemon:onboarded:${address.toLowerCase()}`;

function errMessage(e: unknown, fallback: string): string {
  // viem/wagmi errors carry a human-sized shortMessage; prefer it.
  if (e && typeof e === "object" && "shortMessage" in e) {
    return String((e as { shortMessage: unknown }).shortMessage);
  }
  if (e instanceof ApiError || e instanceof Error) return e.message;
  return fallback;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { address, isConnected, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const subscribeMut = useSubscribe();
  const cancelMut = useCancelSubscription();
  const onboardMut = useOnboard();
  const invokeMut = useInvokeAgent();
  const { subscribeOnChain, phase: txPhase } = useSubscribeOnChain();
  const { cancelOnChain } = useCancelOnChain();
  const { signOneTimePermit } = useOneTimePermit();
  const { data: platformConfig } = usePlatformConfig();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [onboardOpen, setOnboardOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [pendingSub, setPendingSub] = useState<PendingSub | null>(null);
  const [oneTimeOutput, setOneTimeOutput] = useState<InvokeAgentDetails | null>(null);
  const oneTimePending = invokeMut.isPending;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevConnected = useRef(false);

  const wallet = useMemo<Wallet | null>(
    () =>
      isConnected && address
        ? { addr: shortenAddress(address), address, name: connector?.name ?? "wallet" }
        : null,
    [isConnected, address, connector],
  );

  const showToast = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  // When a wallet connects, run onboarding the first time we see this address,
  // otherwise just confirm the connection. Persisted so reload/reconnect is quiet.
  useEffect(() => {
    const justConnected = isConnected && !prevConnected.current;
    prevConnected.current = isConnected;
    if (!justConnected || !address) return;

    const seen =
      typeof window !== "undefined" && localStorage.getItem(onboardedKey(address));
    if (seen) {
      showToast(`wallet connected · ${shortenAddress(address)}`);
    } else {
      setOnboardOpen(true);
    }
  }, [isConnected, address, showToast]);

  const openWalletModal = useCallback(() => {
    openConnectModal?.();
  }, [openConnectModal]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    setOnboardOpen(false);
    showToast("wallet disconnected");
  }, [disconnect, showToast]);

  const finishOnboard = useCallback(
    (handle: string, role: Role) => {
      if (!address) return;
      const clean = handle.trim().replace(/^@/, "") || "anon";
      onboardMut.mutate(
        { address, handle: clean, role: role === "sub" ? "subscriber" : "creator" },
        {
          onSuccess: () => {
            if (typeof window !== "undefined") {
              localStorage.setItem(onboardedKey(address), "1");
            }
            setOnboardOpen(false);
            router.push(role === "sub" ? "/" : "/creator");
            showToast(`welcome, @${clean} · wallet linked`);
          },
          onError: (e) => showToast(errMessage(e, "couldn’t complete onboarding")),
        },
      );
    },
    [address, onboardMut, router, showToast],
  );

  const requestSubscribe = useCallback(
    (sub: PendingSub) => {
      if (!wallet) {
        openWalletModal();
        showToast("connect a wallet to subscribe");
        return;
      }
      setPendingSub(sub);
    },
    [wallet, openWalletModal, showToast],
  );

  const closeSubModal = useCallback(() => {
    setPendingSub(null);
    setOneTimeOutput(null);
  }, []);

  const confirmSubscribe = useCallback(
    async (durationSeconds: number, paramValues: Record<string, string>) => {
      if (!pendingSub || !address) return;
      if (!pendingSub.subPrice || !pendingSub.serviceAddress) {
        showToast("this agent is not configured for subscriptions");
        return;
      }

      // Encode the subscriber's answers so they are emitted on-chain by
      // Subscriptions.subscribe() for the indexer. Empty object → "0x".
      const paramsHex =
        Object.keys(paramValues).length > 0
          ? stringToHex(JSON.stringify(paramValues))
          : ("0x" as `0x${string}`);

      // 1. On-chain: approve USDC → sign Permit2 → Subscriptions.subscribe().
      let subscriptionId: string;
      let txHash: string;
      try {
        const onchain = await subscribeOnChain(
          pendingSub.serviceAddress as `0x${string}`,
          parseUnits(pendingSub.subPrice.amount, USDC_DECIMALS),
          billingIntervalSeconds(pendingSub.billingInterval),
          durationSeconds,
          paramsHex,
        );
        subscriptionId = onchain.subscriptionId;
        txHash = onchain.txHash;
      } catch (e) {
        showToast(errMessage(e, "subscription failed"));
        return;
      }

      // 2. Backend: record the subscription with its on-chain id.
      // Subscriber params are read from the event by the indexer, not sent here.
      subscribeMut.mutate(
        {
          address,
          agentId: pendingSub.agentId,
          subscriptionId,
          txHash,
        },
        {
          onSuccess: () => {
            const name = pendingSub.agentName;
            setPendingSub(null);
            router.push("/subscriptions");
            showToast(`Subscribed to ${name}`);
          },
          onError: (e) => showToast(errMessage(e, "subscription failed")),
        },
      );
    },
    [pendingSub, address, subscribeOnChain, subscribeMut, router, showToast],
  );

  const runOneTime = useCallback(
    async (paramValues: Record<string, string>) => {
      if (!pendingSub || !pendingSub.oneTimePrice) return;
      const platformWalletAddress = platformConfig?.platform_wallet_address;
      if (!platformWalletAddress) {
        showToast("platform wallet not configured");
        return;
      }
      try {
        const amount = parseUnits(pendingSub.oneTimePrice.amount, USDC_DECIMALS);
        const permit = await signOneTimePermit(amount, platformWalletAddress);
        invokeMut.mutate(
          { agentId: pendingSub.agentId, paramValues, permit },
          {
            onSuccess: (data) => setOneTimeOutput(data),
            onError: (e) => showToast(errMessage(e, "run failed")),
          },
        );
      } catch (e) {
        showToast(errMessage(e, "payment signature failed"));
      }
    },
    [pendingSub, invokeMut, signOneTimePermit, showToast, platformConfig],
  );

  const cancelSub = useCallback(
    async (subscriptionId: string, onchainSubId: string, agentName: string) => {
      if (!address) return;
      setCancellingId(subscriptionId);
      try {
        // 1. On-chain: Subscriptions.cancel(id) sets the permit expiry to now
        //    so no further cycles can ever be pulled. Without this the backend
        //    record changes but the subscription stays live on-chain.
        if (onchainSubId) {
          try {
            await cancelOnChain(onchainSubId as `0x${string}`);
          } catch (e) {
            showToast(errMessage(e, "couldn’t cancel on-chain"));
            return;
          }
        }

        // 2. Backend: record the cancellation.
        await new Promise<void>((resolve) =>
          cancelMut.mutate(
            { subscriptionId, address },
            {
              onSuccess: () => {
                showToast(`Cancelled ${agentName} · no further charges`);
                resolve();
              },
              onError: (e) => {
                showToast(errMessage(e, "cancelled on-chain, but couldn’t update record"));
                resolve();
              },
            },
          ),
        );
      } finally {
        setCancellingId(null);
      }
    },
    [address, cancelOnChain, cancelMut, showToast],
  );

  const subscribePhase =
    txPhase !== "idle"
      ? SUBSCRIBE_PHASE_LABEL[txPhase]
      : subscribeMut.isPending
        ? "saving subscription…"
        : null;

  const value = useMemo<AppState>(
    () => ({
      wallet,
      onboardOpen,
      onboardPending: onboardMut.isPending,
      toast,
      pendingSub,
      subscribePending: subscribePhase !== null,
      subscribePhase,
      oneTimeOutput,
      oneTimePending,
      openWalletModal,
      disconnectWallet,
      finishOnboard,
      requestSubscribe,
      closeSubModal,
      confirmSubscribe,
      runOneTime,
      cancelSub,
      cancellingId,
      showToast,
    }),
    [
      wallet,
      onboardOpen,
      onboardMut.isPending,
      toast,
      pendingSub,
      subscribePhase,
      oneTimeOutput,
      oneTimePending,
      openWalletModal,
      disconnectWallet,
      finishOnboard,
      requestSubscribe,
      closeSubModal,
      confirmSubscribe,
      runOneTime,
      cancelSub,
      cancellingId,
      showToast,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
