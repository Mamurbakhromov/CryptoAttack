# Deployment Readiness Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the concrete blockers found in the deployment review so the current branch can be safely merged/deployed.

**Architecture:** Keep runtime behavior unchanged unless a deploy safety gate is missing. Preserve historical database migrations as immutable artifacts, put new schema cleanup in additive migrations, and make production scripts fail before public deployment if audit or migration verification fails.

**Tech Stack:** pnpm 9.15.4, Node.js 24, TypeScript, Fastify, Vite, Vitest, TimescaleDB/Postgres, PM2, Caddy.

---

### Task 1: Patch Dependency Audit Blocker

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Record the failing audit**

Run: `pnpm audit --audit-level high`

Expected before the fix: FAIL with high-severity `fast-uri` advisories.

- [ ] **Step 2: Add the minimal transitive dependency override**

Add a root pnpm override forcing `fast-uri` to a patched version at or above `3.1.2`.

- [ ] **Step 3: Refresh the lockfile**

Run: `pnpm install --frozen-lockfile`

Expected before lock refresh if needed: lockfile mismatch or unchanged vulnerable lock entry.

Run: `pnpm install --lockfile-only`

Expected after refresh: lockfile resolves `fast-uri` to the patched version.

- [ ] **Step 4: Verify audit**

Run: `pnpm audit --audit-level high`

Expected: exit 0, no high-severity advisories.

### Task 2: Restore Immutable Migration History

**Files:**
- Modify: `apps/server/migrations/000001_initial_timescale_schema.sql`
- Restore: `apps/server/migrations/000003_price_labels_context.sql`
- Restore: `apps/server/migrations/000004_scoring_evidence_fields.sql`
- Restore: `apps/server/migrations/000005_backtest_analytics_indexes.sql`
- Restore: `apps/server/migrations/000006_timescale_compression_settings.sql`
- Restore: `apps/server/migrations/000007_forward_return_identity.sql`
- Restore: `apps/server/migrations/000008_current_score_payload.sql`
- Keep: `apps/server/migrations/000009_remove_scoring_storage.sql`
- Modify tests: `apps/server/test/dbMigrations.test.ts`

- [ ] **Step 1: Write the migration-history regression test**

Update the migration test so it expects versions `000001` through `000009` to be present and verifies `000009` owns the obsolete scoring-table cleanup.

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @cryptoattack/server test -- test/dbMigrations.test.ts`

Expected before restoring files: FAIL because versions `000003` through `000008` are missing.

- [ ] **Step 3: Restore deleted historical migration files and original `000001` content**

Use the previous committed contents for migrations `000001` and `000003` through `000008`. Do not remove `000009`; it remains the additive cleanup migration.

- [ ] **Step 4: Verify migration tests**

Run: `pnpm --filter @cryptoattack/server test -- test/dbMigrations.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify an existing-style database has no checksum mismatch**

Run `pnpm db:status` against the current local DB.

Expected after restoration: no checksum mismatch for `000001`; pending `000009` is acceptable until migration is applied.

### Task 3: Add Production Verification Gates

**Files:**
- Modify: `apps/server/src/db/cli.ts`
- Modify tests: `apps/server/test/dbCli.test.ts`
- Modify: `package.json`
- Modify: `apps/server/package.json`
- Modify: `scripts/production/deploy.sh`
- Modify: `scripts/production/preflight.sh`

- [ ] **Step 1: Write a failing CLI test for migration verification**

Add tests for a `db:verify` command that returns nonzero when migrations are pending or checksum-mismatched and returns zero only when all current migration files are applied with matching checksums.

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @cryptoattack/server test -- test/dbCli.test.ts`

Expected before implementation: FAIL because `verify` is not recognized.

- [ ] **Step 3: Implement `db:verify`**

Add `verify` to the database CLI command parser, output the migration status, and return exit code `1` when `pendingCount > 0` or any migration has `checksumMatches === false`.

- [ ] **Step 4: Wire deployment scripts**

Add package scripts for `db:verify`. In production deploy, run `pnpm audit --audit-level high` after install and run `DATABASE_STORAGE_ENABLED=true pnpm db:verify` after migrations.

- [ ] **Step 5: Verify CLI and script behavior**

Run: `pnpm --filter @cryptoattack/server test -- test/dbCli.test.ts`

Expected: PASS.

### Task 4: Add Node 24 Local Guardrail

**Files:**
- Create: `.nvmrc`
- Modify: `README.md`
- Modify: `docs/production-deployment.md`

- [ ] **Step 1: Add `.nvmrc`**

Use a Node 24 LTS version compatible with the existing `engines.node >=24` requirement.

- [ ] **Step 2: Document local activation**

Add short setup notes that developers can run `nvm install && nvm use` before pnpm commands.

- [ ] **Step 3: Verify documentation references**

Run: `rg -n "nvm|Node 24|node-version" .nvmrc README.md docs/production-deployment.md .github/workflows/ci.yml package.json`

Expected: Node 24 is consistently documented.

### Task 5: Full Verification and Commit

**Files:**
- All changed files

- [ ] **Step 1: Run full checks on Node 24 where available**

Run:

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all exit 0.

- [ ] **Step 2: Verify database migrations on a disposable TimescaleDB**

Start a temporary TimescaleDB on a non-default port, run `pnpm db:migrate`, then `pnpm db:verify`.

Expected: migrations apply and verify cleanly.

- [ ] **Step 3: Smoke the built server in mock mode**

Start the built backend with auth enabled against the disposable database. Check `/health`, authenticated `/api/status`, authenticated `/api/storage/status`, frontend HTML, SSE, and unauthorized API rejection.

Expected: all checks pass.

- [ ] **Step 4: Commit the deployment-ready state**

Stage all relevant tracked/untracked project changes except ignored secrets such as `.env`, then commit with a deployment-readiness message.

Expected: `git status --short --branch` is clean on the current `codex/...` branch.
