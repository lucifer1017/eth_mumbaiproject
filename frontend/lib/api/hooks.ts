"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AgentQuery,
  cancelSubscription,
  createSubscription,
  getAgent,
  getCreatorEarnings,
  getPlatformConfig,
  invokeAgent,
  listAgents,
  listCreatorAgents,
  listCreatorRuns,
  listSubscribers,
  listUserRuns,
  listUserSubscriptions,
  onboardUser,
  recordRun,
  registerAgent,
  updateAgent,
} from "./endpoints";
import type {
  RegisterAgentInput,
  SubscriptionStatus,
  UpdateAgentInput,
  UserRole,
} from "./types";
import type { OneTimePermit } from "../useSubscribeOnChain";

export const queryKeys = {
  agents: (query: AgentQuery) => ["agents", query] as const,
  agent: (agentId: string) => ["agent", agentId] as const,
  subscriptions: (address?: string, status?: string) =>
    ["subscriptions", address, status] as const,
  runs: (address?: string, page?: number) => ["runs", address, page] as const,
  creatorAgents: (address?: string) => ["creator-agents", address] as const,
  subscribers: (address?: string, agentId?: string) =>
    ["subscribers", address, agentId] as const,
  earnings: (address?: string) => ["earnings", address] as const,
  creatorRuns: (address?: string, agentId?: string) =>
    ["creator-runs", address, agentId] as const,
  platformConfig: ["platform-config"] as const,
};

// ── platform config ────────────────────────────────

export function usePlatformConfig() {
  return useQuery({
    queryKey: queryKeys.platformConfig,
    queryFn: getPlatformConfig,
    staleTime: Infinity,
  });
}

// ── marketplace ───────────────────────────────────

export function useAgents(query: AgentQuery = {}) {
  return useQuery({
    queryKey: queryKeys.agents(query),
    queryFn: () => listAgents(query),
  });
}

export function useAgent(agentId: string) {
  return useQuery({
    queryKey: queryKeys.agent(agentId),
    queryFn: () => getAgent(agentId),
    enabled: !!agentId,
  });
}

// ── subscriptions & spendings (wallet-scoped) ─────

export function useUserSubscriptions(address?: string, status?: SubscriptionStatus) {
  return useQuery({
    queryKey: queryKeys.subscriptions(address, status),
    queryFn: () => listUserSubscriptions(address!, status),
    enabled: !!address,
  });
}

export function useUserRuns(address?: string, page = 1, limit = 20) {
  return useQuery({
    queryKey: queryKeys.runs(address, page),
    queryFn: () => listUserRuns(address!, page, limit),
    enabled: !!address,
    refetchInterval: 30_000,
  });
}

// ── creator (wallet-scoped) ───────────────────────

export function useCreatorAgents(address?: string) {
  return useQuery({
    queryKey: queryKeys.creatorAgents(address),
    queryFn: () => listCreatorAgents(address!),
    enabled: !!address,
  });
}

export function useSubscribers(address?: string, agentId?: string) {
  return useQuery({
    queryKey: queryKeys.subscribers(address, agentId),
    queryFn: () => listSubscribers(address!, agentId!),
    enabled: !!address && !!agentId,
  });
}

export function useCreatorEarnings(address?: string) {
  return useQuery({
    queryKey: queryKeys.earnings(address),
    queryFn: () => getCreatorEarnings(address!),
    enabled: !!address,
  });
}

export function useCreatorRuns(address?: string, agentId?: string) {
  return useQuery({
    queryKey: queryKeys.creatorRuns(address, agentId),
    queryFn: () => listCreatorRuns(address!, agentId),
    enabled: !!address,
    refetchInterval: 30_000,
  });
}

// ── mutations ─────────────────────────────────────

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      address: string;
      agentId: string;
      subscriptionId: string;
      txHash: string;
    }) => createSubscription(vars.address, vars.agentId, vars.subscriptionId, vars.txHash),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["subscriptions", vars.address] });
      qc.invalidateQueries({ queryKey: queryKeys.runs(vars.address) });
      qc.invalidateQueries({ queryKey: queryKeys.agent(vars.agentId) });
    },
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { subscriptionId: string; address: string }) =>
      cancelSubscription(vars.subscriptionId, vars.address),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["subscriptions", vars.address] });
    },
  });
}

export function useInvokeAgent() {
  return useMutation({
    mutationFn: (vars: { agentId: string; paramValues: Record<string, string>; permit: OneTimePermit }) =>
      invokeAgent(vars.agentId, vars.paramValues, vars.permit),
  });
}

export function useRecordRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recordRun,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.runs(vars.userAddress) });
    },
  });
}

export function useOnboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { address: string; handle: string; role: UserRole }) =>
      onboardUser(vars.address, vars.handle, vars.role),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["user", vars.address] });
    },
  });
}

export function useRegisterAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterAgentInput) => registerAgent(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.creatorAgents(input.user_address) });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAgentInput) => updateAgent(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.creatorAgents(input.user_address) });
      qc.invalidateQueries({ queryKey: queryKeys.agent(input.agent_id) });
    },
  });
}
