# Ontology v2 Cutover Checklist

Date: 2026-11-10
Scope: `ONTOLOGY_V2` shadow → on, then legacy decommission.
Companions: [Runbook](./2026-11-10-ontology-v2-runbook.md) ·
[Preflight SQL](../deploy/preflight-ontology-v2.sql) ·
[Deployment guide](./2026-11-09-sse-deployment.md)

Run the steps in order. Do not skip the 24h shadow gate. Each `curl` below is
against the local API; replace host/port as needed. `ADMIN_TOKEN` must belong to
an `admin` account.

---

## 1. Preconditions

- [ ] **Backup taken and verified** (PostgreSQL + MinIO; see deployment guide §4.6).

  ```bash
  pg_dump -Fc -h "$DB_HOST" -p "${DB_PORT:-5433}" -U "$DB_USER" "$DB_NAME" \
    -f "sse-pre-ontology-v2-$(date +%Y%m%d%H%M).dump"
  pg_restore --list "sse-pre-ontology-v2-"*.dump > /dev/null && echo backup-ok
  ```

- [ ] **Exactly one API replica** is running. Each process owns an independent
  in-memory graph and the projector only lets the advisory-lock winner drain.

  ```bash
  ps -ef | grep 'packages/api/dist/index.js' | grep -v grep
  ```

- [ ] **Node 24** is installed for the release process.

  ```bash
  node -v   # v24.x
  pnpm -v   # 9.x
  ```

- [ ] **`NODE_ENV=production`**.
- [ ] **`TRUST_PROXY=1`** (or the exact number of proxy hops). If this is wrong,
  `req.ip` is the proxy address and login rate limiting collapses onto one key.
- [ ] **nginx forwards `X-Forwarded-For`** (see deployment guide §4.3):

  ```nginx
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  ```

- [ ] **Service tokens are set**: `SCIM_TOKEN`, `MDM_TOKEN` (or `WEBHOOK_TOKEN`).
- [ ] **`ALLOW_LEGACY_PLAINTEXT_PASSWORDS` is unset or `0`**.
- [ ] **No raw `$` in `.env` values** (especially bcrypt hashes or generated
  secrets). Docker Compose interpolates `$VAR`; escape as `$$` or use single
  quotes. Bcrypt hashes belong in the database, not `.env`. If `docker compose`
  prints warnings like `The "jFK" variable is not set`, inspect
  `grep -n '\$' .env` and fix the offending line.
- [ ] **`BCRYPT_ROUNDS=10`** (allowed range 10–14).

## 2. Preflight and credential rotation

- [ ] Run the read-only preflight against the production database.

  ```bash
  psql "host=$DB_HOST port=${DB_PORT:-5433} dbname=$DB_NAME user=$DB_USER" \
    -v ON_ERROR_STOP=1 -f deploy/preflight-ontology-v2.sql
  ```

- [ ] **Review section 2.** `!` is the intentional unusable sentinel written by
  migration 018 for SCIM/MDM/no-password users. It is not a login credential.
  - If those users authenticate through SCIM/MDM, no action is needed.
  - If they need password login, reset each one from **Admin → Users → 编辑**
    (or set a bcrypt hash directly as shown below).
  - Empty, whitespace, `scim_managed_no_pwd`, and `mdm_managed_no_pwd` must be
    zero after migration 018.
- [ ] **Rotate the default admin** if section 3 reports
  `has_legacy_default_hash = true` or `has_current_seed_hash = true`.

  If `admin123` still works, use the API:

  ```bash
  ADMIN_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"phone":"13800000000","password":"admin123"}' | jq -r .accessToken)

  curl -s -X PUT http://127.0.0.1:3000/auth/password \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"oldPassword":"admin123","newPassword":"<strong-new-password>"}'
  ```

  If the old hash no longer matches `admin123`, set a bcrypt hash directly
  (run from the repo root; `psql` uses `:'hash'` so the `$` characters are safe):

  ```bash
  HASH=$(pnpm --filter @sse/auth exec node -e \
    "console.log(require('bcrypt').hashSync(process.argv[1], 10))" \
    '<strong-new-password>')

  docker compose exec -T postgres psql -U sse -d sse \
    -v hash="$HASH" \
    -c "UPDATE users SET password_hash = :'hash' WHERE phone = '13800000000';"

  docker compose exec -T postgres psql -U sse -d sse \
    -c "SELECT phone, left(password_hash, 7) FROM users WHERE phone = '13800000000';"
  ```

  Re-login with the new password to refresh `ADMIN_TOKEN` before continuing.
  Then reset the six `!` accounts from Admin → Users if they need password login.
- [ ] Confirm section 1 shows all four migrations `applied = true` or that they
  are queued for step 3.

## 3. Apply migrations 015–018

Run in a low-traffic window. The migrations add tables/columns and create row
triggers on the eight mapped tables.

- [ ] Load the environment and build the migration runner.

  ```bash
  set -a; . ./.env; set +a
  pnpm -r build
  pnpm migrate
  ```

- [ ] Verify the applied versions.

  ```bash
  psql "host=$DB_HOST port=${DB_PORT:-5433} dbname=$DB_NAME user=$DB_USER" \
    -c "SELECT version, applied_at FROM schema_migrations WHERE version LIKE '01[5-8]%' ORDER BY version;"
  ```

- [ ] Re-run `deploy/preflight-ontology-v2.sql`. Sections 4 and 6 must now resolve
  (no `SKIP` messages). `outbox_enabled` may still be `'false'` at this point.

## 4. Shadow boot

- [ ] Set `ONTOLOGY_V2=shadow` and restart the API (single replica only).

  ```bash
  # e.g. systemd:
  #   Environment=ONTOLOGY_V2=shadow
  systemctl restart sse-api
  ```

- [ ] Check status. Expect `engine = "oxigraph"`, non-zero `counts.quads`,
  `outbox.pending = 0`, `outbox.deadLettered = 0`, `failuresLastHour = 0`, and
  `shadow.equal = true` after the first comparison.

  ```bash
  curl -s http://127.0.0.1:3000/ontology/status \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq
  ```

- [ ] Check liveness/readiness.

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/healthz   # 200
  ```

- [ ] Force a deterministic rebuild and let it finish.

  ```bash
  JOB_ID=$(curl -s -X POST http://127.0.0.1:3000/ontology/reconcile \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r .job_id)
  curl -s http://127.0.0.1:3000/ontology/reconcile/$JOB_ID \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq
  # expect state = "done", a non-zero counts.quads, and a checksum
  ```

## 5. 24h shadow gate

- [ ] Keep `ONTOLOGY_V2=shadow` for at least **24 consecutive hours**.
- [ ] Every comparison must report `shadow.equal = true`; consecutive clean runs,
  not a single sample.
- [ ] Investigate every difference. Reads are sequential, so a transient diff can
  appear under continuous writes; require consecutive clean runs (or run the gate
  in a low-write window) before cutover.
- [ ] `outbox.pending = 0` and `outbox.deadLettered = 0` throughout.
- [ ] No projector crash loops and `outbox.oldestPendingAgeSeconds < 300`.
- [ ] Record the evidence (status snapshots, reconcile checksum) in the change
  record.

## 6. MCP smoke

- [ ] `tools/list` returns **22 tools**.

  ```bash
  # HTTP MCP; use any valid, active admin key.
  curl -s -X POST http://127.0.0.1:3001/mcp \
    -H 'Authorization: Bearer <admin-key>' \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```

  Expected names: `query_ontology`, `get_entity_network`, `query_sparql`,
  `explain_expense`, `explain_decision`, `impact_analysis`, `find_anomalies`,
  `get_ontology_schema`, `validate_expense`, `verify_expense`,
  `query_expense_status`, `get_expense_detail`, `search_expenses`,
  `get_approval_status`, `list_pending_approvals`, `get_statistics`,
  `get_user_summary`, `submit_expense_from_text`, `submit_expense_from_invoice`,
  `upload_invoice`, `approve_expense`, `reject_expense`.

- [ ] Ontology tools return data: `query_ontology`, `get_entity_network`,
  `query_sparql`, `explain_expense`, `impact_analysis`, `find_anomalies`,
  `get_ontology_schema`.
- [ ] **Employee forbidden**: an `employee` key calling `query_sparql` returns
  `FORBIDDEN` (`仅管理员和财务可执行 SPARQL 查询`).
- [ ] **Deactivated key unauthorized**: a disabled/expired API key returns
  `UNAUTHORIZED`.

## 7. Cutover

- [ ] Confirm the 24h gate passed on the exact release commit.
- [ ] Set `ONTOLOGY_V2=on` and restart the API **and** MCP.

  ```bash
  # e.g. systemd:
  #   Environment=ONTOLOGY_V2=on
  systemctl restart sse-api sse-mcp
  ```

- [ ] Re-check `/ontology/status` and `/healthz`; `/healthz` returns `503` if
  `outbox.oldestPendingAgeSeconds > 300`.
- [ ] Monitor for at least one business cycle:
  - `outbox.pending` and `outbox.oldestPendingAgeSeconds`
  - `outbox.deadLettered` (must stay 0)
  - `counts.quads` vs SQL counts from preflight section 5
  - API logs for `[ontology-projector]` / `[ontology-shadow]`

## 8. Rollback

Business writes are never blocked by the projector. To return to the legacy path:

- [ ] Set `ONTOLOGY_V2=0` in every API process.
- [ ] Disable the outbox so it stops growing until a projector is re-enabled.

  ```bash
  PGPASSWORD="$DB_PASSWORD" psql \
    -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5433}" \
    -U "${DB_USER:-sse}" -d "${DB_NAME:-sse}" \
    -c "UPDATE ontology_settings SET value='false' WHERE key='outbox_enabled';"
  ```

- [ ] Restart the API (and MCP).
- [ ] **Re-run the legacy sync after restart** to warm the legacy `OwlStore`.

  ```bash
  curl -s http://127.0.0.1:3000/ontology/sync \
    -H "Authorization: Bearer $ADMIN_TOKEN"
  ```

- [ ] Note: manual v2 edits live only in `urn:sse:manual` and the v2 snapshot.
  The legacy `/ontology/sync` reads Postgres, so it **cannot recover manual graph
  edits**; capture or re-enter them before rollback if they must survive.

## 9. Post-cutover verification

- [ ] `admin123` is rotated: the old password returns `401`.
- [ ] An admin-created user can log in with the password set at creation.
- [ ] A wrong password returns `401` (and does not reveal account existence).
- [ ] The 10-attempt / 15-minute login limit returns `429 RATE_LIMITED`
  (per-process; requires the single-replica constraint).
- [ ] A disabled account with the **correct** password returns `403`
  (`账号已被禁用`); with a wrong password it returns `401`.
- [ ] `SCIM` and `MDM` return `401` without a token (and `503
  SERVICE_TOKEN_NOT_CONFIGURED` only when the token is unset in production).

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/scim/Users \
    -H 'Content-Type: application/json' -d '{}'                       # 401
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/webhook/mdm \
    -H 'Content-Type: application/json' -d '{}'                       # 401
  ```

- [ ] Verify grants on the v2 objects (application role can read/write, sequence
  usage present).

  ```bash
  psql "host=$DB_HOST port=${DB_PORT:-5433} dbname=$DB_NAME user=$DB_USER" \
    -c "SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = current_user
          AND table_name IN ('ontology_graph_snapshots','ontology_projector_state','ontology_outbox','ontology_settings')
        ORDER BY table_name, privilege_type;"
  psql ... -c "SELECT has_sequence_privilege(current_user, 'ontology_snapshot_version_seq', 'USAGE') AS snap_seq_usage,
                      has_sequence_privilege(current_user, 'ontology_outbox_id_seq', 'USAGE') AS outbox_seq_usage;"
  ```

## 10. Legacy removal

Only after **one clean `on` release** (plus the 24h shadow gate) is complete:

- [ ] Collect the decommission evidence: `shadow.equal = true`, zero
  pending/dead letters, successful reconcile checksum.
- [ ] Remove the deprecated legacy paths listed in the runbook §8
  (`SemanticMapper.syncReportToOntology` / `syncAll`, `executeSparql`, `OwlStore`,
  legacy `/ontology/sync` / `/ontology/query` / `/ontology/graph` branches).
- [ ] Do **not** drop `ontology_snapshots` or legacy ontology data in the same
  release. Remove them only after a second clean release and a verified backup.
