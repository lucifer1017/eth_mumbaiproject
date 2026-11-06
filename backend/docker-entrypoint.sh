#!/bin/sh
set -e

: "${DB_HOST:=postgres}"
: "${DB_PORT:=5432}"

echo "Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -q; do
  sleep 1
done

echo "Running migrations..."
npm run db:migrate

echo "Starting API server..."
exec "$@"