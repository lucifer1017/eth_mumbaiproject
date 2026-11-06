#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Agentic DCA — end-to-end demo script
#
# Usage:  ./demo.sh                 (interactive mode)
#         ./demo.sh quick           (skip menu, use preset params)
#         ./demo.sh agent-only      (start agent, no subscriptions)
#
# Requires: forge, node, python3, jq
# All contract addresses read from contracts/deployments/arbitrum-sepolia.json
# All secrets read from backend/.env
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$ROOT/contracts"
BACKEND_DIR="$ROOT/backend"
DEPLOY_JSON="$CONTRACT_DIR/deployments/arbitrum-sepolia.json"
LOG_FILE="$(mktemp /tmp/sip-agent-XXXXXX.log)"
AGENT_PID=""

# ── Colours ───────────────────────────────────────────────────────────────────
R='\033[0;31m'  G='\033[0;32m'  Y='\033[1;33m'
B='\033[0;34m'  C='\033[0;36m'  W='\033[1m'   D='\033[0m'

# ── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  if [[ -n "$AGENT_PID" ]] && kill -0 "$AGENT_PID" 2>/dev/null; then
    echo -e "${Y}Stopping agent (PID $AGENT_PID)…${D}"
    kill "$AGENT_PID" 2>/dev/null || true
    wait "$AGENT_PID" 2>/dev/null || true
  fi
  local confirmed=0
  if [[ -f "$LOG_FILE" ]]; then
    confirmed=$(grep -c '"confirmed"' "$LOG_FILE" 2>/dev/null || true)
  fi
  echo -e "\n${W}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${D}"
  echo -e "${W}  Demo ended — ${G}${confirmed} execution(s) confirmed${D}"
  echo -e "${W}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${D}\n"
  rm -f "$LOG_FILE"
}
trap cleanup INT TERM EXIT

# ── Inline pino-JSON → human log formatter ────────────────────────────────────
# Embedded as a heredoc; requires only python3 (always present on macOS/Linux).
LOG_FMT_SCRIPT="$(cat <<'PYEOF'
import sys, json, datetime, re

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
B='\033[0;34m'; C='\033[0;36m'; W='\033[1m'
D='\033[0m';    DIM='\033[2m'

SKIP = {'level','time','pid','hostname','msg','component'}

def fmt_extras(d):
    pairs = [(k, d[k]) for k in d if k not in SKIP]
    return '  '.join(f'{k}={v}' for k, v in pairs)

def ts(epoch_ms):
    try:
        return datetime.datetime.fromtimestamp(int(epoch_ms)/1000).strftime('%H:%M:%S')
    except Exception:
        return '--:--:--'

for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    try:
        d = json.loads(raw)
    except Exception:
        print(raw); sys.stdout.flush(); continue

    lvl   = d.get('level', 30)
    msg   = d.get('msg', '')
    t     = ts(d.get('time', 0))
    extra = fmt_extras(d)

    if 'confirmed' in msg:
        print(f'{G}{W}[{t}] ✓ CONFIRMED    {extra}{D}')
    elif 'executing subscription' in msg:
        print(f'{C}{W}[{t}] ⚡ EXECUTING    {extra}{D}')
    elif 'tx submitted' in msg:
        print(f'{B}[{t}] ↑ TX SENT      {extra}{D}')
    elif 'skipped by Claude' in msg:
        print(f'{Y}[{t}] ⚠ CLAUDE SKIP  {extra}{D}')
    elif 'gas ceiling' in msg.lower() or 'GAS_CEILING' in extra:
        print(f'{Y}[{t}] ⛽ GAS HIGH     {extra}{D}')
    elif 'scheduler tick' in msg:
        cnt = d.get('count', '?')
        print(f'{DIM}[{t}] ⏱  tick  {cnt} active sub(s){D}')
    elif 'subscription discovered' in msg:
        print(f'{G}[{t}] + NEW SUB       {extra}{D}')
    elif 'subscription cancelled' in msg:
        print(f'{Y}[{t}] - CANCELLED     {extra}{D}')
    elif 'initial sync complete' in msg:
        print(f'{G}[{t}] ✓ INDEXER READY  {extra}{D}')
    elif 'chain connected' in msg:
        print(f'{G}[{t}] ✓ CONNECTED      {extra}{D}')
    elif 'mock x402 server listening' in msg:
        print(f'{G}[{t}] ✓ X402 SERVER    {extra}{D}')
    elif 'permit expired' in msg or 'not found' in msg:
        pass   # suppress noise
    elif 'not due yet' in msg:
        pass   # suppress — too frequent
    elif lvl >= 50:
        print(f'{R}{W}[{t}] ✗ FATAL        {msg}  {extra}{D}')
    elif lvl >= 40:
        print(f'{Y}[{t}] ! WARN          {msg}  {extra}{D}')
    elif lvl >= 30:
        print(f'[{t}]    {msg}  {extra}')
    # debug (lvl<30) suppressed in demo

    sys.stdout.flush()
PYEOF
)"

# ── Helper: countdown ─────────────────────────────────────────────────────────
countdown() {
  local secs=$1 label=$2
  while [[ $secs -gt 0 ]]; do
    printf "\r  %s in %3ds…" "$label" "$secs"
    sleep 1
    (( secs-- )) || true
  done
  printf "\r%-50s\r" " "
}

# ── Helper: step header ───────────────────────────────────────────────────────
step() { echo -e "\n${W}${C}▶  $1${D}"; }
ok()   { echo -e "${G}  ✓ $1${D}"; }
fail() { echo -e "${R}  ✗ $1${D}"; exit 1; }

# ── Banner ─────────────────────────────────────────────────────────────────────
clear
echo -e "${W}${C}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   Agentic DCA — End-to-End Demo              ║"
echo "  ║   ERC-8004 · x402 · Arbitrum Sepolia         ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${D}"

# ── Prerequisites ──────────────────────────────────────────────────────────────
step "Checking prerequisites"
for cmd in forge node python3 jq; do
  command -v "$cmd" &>/dev/null && ok "$cmd found" || fail "$cmd not found — install it first"
done

# ── Load env ───────────────────────────────────────────────────────────────────
step "Loading environment"
ENV_FILE="$BACKEND_DIR/.env"
[[ -f "$ENV_FILE" ]] || fail ".env not found at $ENV_FILE"
set -a; source "$ENV_FILE"; set +a

[[ -n "${PRIVATE_KEY:-}" ]] || fail "PRIVATE_KEY not set in .env"
[[ -n "${RPC_URL:-}"     ]] || fail "RPC_URL not set in .env"

# Derive subscriber address from private key using node/viem (run from backend so the module resolves)
SUBSCRIBER=$(cd "$BACKEND_DIR" && node --input-type=module <<EOF
import { privateKeyToAccount } from 'viem/accounts'
console.log(privateKeyToAccount('${PRIVATE_KEY}').address)
EOF
)

ok "Subscriber: $SUBSCRIBER"
[[ -n "${COINCAP_KEY:-}"      ]] && ok "CoinCap Pro: enabled"   || echo -e "  ${Y}  CoinCap: not set — fallback price${D}"
[[ -n "${ANTHROPIC_API_KEY:-}" ]] && ok "Claude oracle: enabled" || echo -e "  ${Y}  Claude: not set — deterministic mode${D}"

# ── Deployment addresses ───────────────────────────────────────────────────────
step "Reading deployment"
[[ -f "$DEPLOY_JSON" ]] || fail "deployments/arbitrum-sepolia.json not found — deploy contracts first"

SUBSCRIPTIONS=$(jq -r '.subscriptions'   "$DEPLOY_JSON")
MOCK_USDC=$(jq -r '.mockUSDC'         "$DEPLOY_JSON")
MOCK_WETH=$(jq -r '.mockWETH'         "$DEPLOY_JSON")
VALIDATION=$(jq -r '.validationRegistry' "$DEPLOY_JSON")

echo -e "  Subscriptions: ${C}$SUBSCRIPTIONS${D}"
echo -e "  mockUSDC:      ${C}$MOCK_USDC${D}"
echo -e "  mockWETH:      ${C}$MOCK_WETH${D}"
echo -e "  Validation:    ${C}$VALIDATION${D}"

# ── Demo mode ──────────────────────────────────────────────────────────────────
MODE="${1:-}"

if [[ "$MODE" == "quick" ]]; then
  DEMO_MODE="quick"
elif [[ "$MODE" == "agent-only" ]]; then
  DEMO_MODE="agent"
else
  step "Choose demo mode"
  echo -e "  ${G}[1]${D} Quick     — 2 subs: 20 USDC×3 (4 min interval) + 15 USDC×2 (3m45s)"
  echo -e "  ${G}[2]${D} Custom    — enter your own amounts and intervals"
  echo -e "  ${G}[3]${D} Agent only — start agent without creating new subscriptions"
  read -rp "  Choice [1/2/3, default=1]: " RAW_CHOICE
  case "${RAW_CHOICE:-1}" in
    1|"") DEMO_MODE="quick"  ;;
    2)    DEMO_MODE="custom" ;;
    3)    DEMO_MODE="agent"  ;;
    *)    DEMO_MODE="quick"  ;;
  esac
fi

if [[ "$DEMO_MODE" == "quick" ]]; then
  S1_AMOUNT=20000000; S1_INTERVAL=240;  S1_WINDOW=800
  S2_AMOUNT=15000000; S2_INTERVAL=225;  S2_WINDOW=750
  SUB_DELAY=30
  echo -e "  Mode: ${G}Quick${D}  (sub1=20 USDC/4min, sub2=15 USDC/3m45s, 30s apart)"

elif [[ "$DEMO_MODE" == "custom" ]]; then
  step "Custom subscription parameters"
  read -rp "  Sub 1 — amount in USDC units (6 dec, e.g. 10000000 = 10 USDC): " S1_AMOUNT
  read -rp "  Sub 1 — interval (seconds): " S1_INTERVAL
  read -rp "  Sub 1 — window duration (seconds): " S1_WINDOW
  read -rp "  Sub 2 — amount in USDC units: " S2_AMOUNT
  read -rp "  Sub 2 — interval (seconds): " S2_INTERVAL
  read -rp "  Sub 2 — window duration (seconds): " S2_WINDOW
  read -rp "  Delay between sub 1 and sub 2 (seconds): " SUB_DELAY
fi

# ── Start agent ────────────────────────────────────────────────────────────────
step "Starting agent"
cd "$BACKEND_DIR"
npm run start >"$LOG_FILE" 2>&1 &
AGENT_PID=$!
echo -e "  PID: ${W}$AGENT_PID${D}  log: ${D}$LOG_FILE${D}"

# Wait for indexer to complete its initial chain scan (up to 60s)
echo -n "  Waiting for indexer sync"
for i in $(seq 1 60); do
  if grep -q '"initial sync complete"' "$LOG_FILE" 2>/dev/null; then
    echo -e " ${G}✓${D}"
    break
  fi
  if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    echo ""
    echo -e "${R}  Agent crashed. Last output:${D}"
    tail -20 "$LOG_FILE" | python3 -c "$LOG_FMT_SCRIPT" 2>/dev/null || tail -20 "$LOG_FILE"
    exit 1
  fi
  printf "."
  sleep 1
done
ok "Agent ready"

# ── Create subscriptions ───────────────────────────────────────────────────────
if [[ "$DEMO_MODE" != "agent" ]]; then
  step "Creating subscription 1  (${S1_AMOUNT} USDC/cycle, ${S1_INTERVAL}s interval, ${S1_WINDOW}s window)"
  cd "$CONTRACT_DIR"
  SUB1_OUT=$(SPEND_PER_CYCLE=$S1_AMOUNT INTERVAL_SECS=$S1_INTERVAL WINDOW_SECS=$S1_WINDOW \
    forge script script/Subscribe.s.sol \
      --rpc-url "$RPC_URL" \
      --broadcast \
      --silent 2>&1 || true)
  SUB1_ID=$(echo "$SUB1_OUT" | grep -oE '0x[0-9a-fA-F]{64}' | tail -1 || echo "")
  echo "$SUB1_OUT" | grep -E "Subscription created|Executions|USDC" | sed 's/^/  /' || true
  [[ -n "$SUB1_ID" ]] && ok "Sub 1 ID: $SUB1_ID" || echo -e "${Y}  (ID not captured — check forge output)${D}"

  step "Waiting ${SUB_DELAY}s before creating subscription 2"
  countdown "$SUB_DELAY" "Sub 2 in"

  step "Creating subscription 2  (${S2_AMOUNT} USDC/cycle, ${S2_INTERVAL}s interval, ${S2_WINDOW}s window)"
  SUB2_OUT=$(SPEND_PER_CYCLE=$S2_AMOUNT INTERVAL_SECS=$S2_INTERVAL WINDOW_SECS=$S2_WINDOW \
    forge script script/Subscribe.s.sol \
      --rpc-url "$RPC_URL" \
      --broadcast \
      --silent 2>&1 || true)
  SUB2_ID=$(echo "$SUB2_OUT" | grep -oE '0x[0-9a-fA-F]{64}' | tail -1 || echo "")
  echo "$SUB2_OUT" | grep -E "Subscription created|Executions|USDC" | sed 's/^/  /' || true
  [[ -n "$SUB2_ID" ]] && ok "Sub 2 ID: $SUB2_ID" || echo -e "${Y}  (ID not captured — check forge output)${D}"
fi

# ── Live feed ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${W}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${D}"
echo -e "${W}  Agent live feed  ·  Press Ctrl+C to stop${D}"
echo -e "${W}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${D}"
echo ""

# Stream log file through inline formatter, skipping lines already written before now
LINES_BEFORE=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
tail -n +"$((LINES_BEFORE + 1))" -f "$LOG_FILE" | python3 -c "$LOG_FMT_SCRIPT"
