#!/usr/bin/env bash
# Sets up the Daemon backend for local development:
# - starts PostgreSQL@14 (Homebrew)
# - creates the sip_daemon database if missing
# - installs npm dependencies
# - copies .env.example -> .env if missing
# - runs DB migrations and seed data
set -euo pipefail

cd "$(dirname "$0")"

DB_NAME="sip_daemon"

echo "==> Checking PostgreSQL service"
if ! brew services list | grep -q "postgresql@14.*started"; then
  echo "    Starting postgresql@14..."
  brew services start postgresql@14
  echo "    Waiting for PostgreSQL to accept connections..."
  until pg_isready -q; do sleep 1; done
else
  echo "    postgresql@14 already running"
fi

echo "==> Ensuring database '$DB_NAME' exists"
if ! psql -lqt | cut -d '|' -f 1 | grep -qw "$DB_NAME"; then
  createdb "$DB_NAME"
  echo "    Created database '$DB_NAME'"
else
  echo "    Database '$DB_NAME' already exists"
fi

echo "==> Setting up .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    Created .env from .env.example — fill in secrets (PRIVATE_KEY, ANTHROPIC_API_KEY, COINCAP_KEY) before running the agent"
else
  echo "    .env already exists, leaving as-is"
fi

echo "==> Installing npm dependencies"
npm install

echo "==> Running database migrations"
npm run db:migrate

echo "==> Seeding database"
npm run db:seed

echo ""
echo "Setup complete. Start the API with:  npm run api:dev"
echo "Start the agent with:                npm run dev"
