# Ontology v2 Runbook — Shadow, Cutover, Rollback

Date: 2026-11-10
Scope: `ONTOLOGY_V2=0|shadow|on`

PostgreSQL is the system of record. Row triggers write every mapped change to
`ontology_outbox`; the API projector drains it into an embedded Oxigraph graph
and persists versioned N-Quads snapshots in `ontology_graph_snapshots`.
The graph is rebuildable at any time from Postgres.

## 1. Preconditions

1. A database backup has been taken and verified.
2. Migrations `015_ontology_graph_snapshots.sql`,
   `016_ontology_outbox.sql`, and `017_ontology_rules_v2.sql` are applied.
   Before running 017, preflight duplicate rule names; the migration deletes
   duplicates keeping the lowest UUID `id`, then creates
   `uq_reasoning_rules_name`:

   ```sql
   SELECT name, COUNT(*), MIN(id), MAX(id)
     FROM reasoning_rules
    GROUP BY name
   HAVING COUNT(*) > 1;
   ```

   Review the rows first (the migration intentionally keeps the lowest id). If
   you cannot accept that, resolve them manually before running the migration.
3. Run `ADD COLUMN` / `CREATE TRIGGER` migrations in a low-traffic window. They
   take table locks on `reasoning_rules` and the mapped business tables; the
   trigger creation also compiles the function once per table.
4. `pnpm -r build` and `pnpm -r test` are green on the release commit.
5. **Exactly one API replica** may run with `ONTOLOGY_V2=shadow|on`. Each
   process owns an independent in-memory Oxigraph graph and only the advisory
   lock winner drains the outbox, so additional replicas serve stale/divergent
   graphs. A shared graph store or leader election is a production prerequisite
   before horizontal scaling.
6. The outbox triggers are still disabled (`ontology_settings.outbox_enabled =
   'false'`) until a projector is running. `startOntologyProjector()` disables
   them while starting and enables them only after TBox load, snapshot
   restore/reconcile and `runner.start()`. If startup fails it disables them and
   the API exits non-zero.
7. Capacity: monitor PostgreSQL for trigger overhead and the API process for
   graph memory growth (`counts.quads` from `/ontology/status`).

## 2. Backfill / reconcile

Start the API with `ONTOLOGY_V2=shadow`. On the first boot without a snapshot the
projector performs a full reconcile automatically. To force a rebuild:

```bash
curl -s -X POST http://127.0.0.1:3000/ontology/reconcile \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

The endpoint returns `202 { job_id, state }`. Poll it:

```bash
curl -s http://127.0.0.1:3000/ontology/reconcile/$JOB_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected result: `state = done`, non-zero `counts.quads`, and a `checksum`.
A deterministic rebuild from the same Postgres state must produce the same
checksum as the incremental projection.

The legacy `GET /ontology/sync` is a compatibility alias. When `ONTOLOGY_V2=on`
it starts the same reconcile job instead of running the old `SemanticMapper`.

## 3. Verification

1. Status:

   ```bash
   curl -s http://127.0.0.1:3000/ontology/status \
     -H "Authorization: Bearer $ADMIN_TOKEN" | jq
   ```

   Confirm `engine = "oxigraph"`, non-zero `counts`, `outbox.pending = 0`,
   `outbox.deadLettered = 0`, `failuresLastHour = 0`, and (in shadow mode)
   `shadow.equal = true`.
   Full `shadow.differences` are admin-only because they contain record IDs and
   whitelisted values. Other callers receive the status without the diff.

2. Health:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/healthz
   ```

   With `ONTOLOGY_V2=on`, `/health` and `/healthz` return `503` when
   `outbox.oldestPendingAgeSeconds > 300`; otherwise `200`. The pre-v2 payload is
   unchanged for `0` and `shadow`.

3. Sample SPARQL (admin/finance only):

   ```bash
   curl -s -X POST http://127.0.0.1:3000/ontology/sparql \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"query":"SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5"}'
   ```

4. Walk an entity and its evidence:

   ```bash
   curl -s http://127.0.0.1:3000/ontology/entities/<url-encoded-report-uri> \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   curl -s -X POST http://127.0.0.1:3000/ontology/explain \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"report_id":"<report-id>"}'
   ```

5. MCP smoke: `query_ontology`, `get_entity_network`, `query_sparql`,
   `explain_expense`, `impact_analysis`, `find_anomalies`, and
   `get_ontology_schema` return data through the API thin client.

## 4. Shadow 24h gate

1. Set `ONTOLOGY_V2=shadow` and restart the API. The v2 routes are mounted for
   `on|shadow` and serve reads. Only the legacy `SemanticMapper` report writes
   keep running, so the legacy graph stays warm for rollback. v2 manual edits
   (`PUT/DELETE /ontology/entity`, `/ontology/relation`, `/ontology/from-text`)
   are written to `urn:sse:manual` and the v2 snapshot only; they are **not**
   mirrored into the legacy `OwlStore` and will be absent from legacy reads
   after a rollback unless you re-run the legacy sync step in §6.
2. The SQL-truth comparator runs immediately and then every
   `ONTOLOGY_SHADOW_INTERVAL_MS` (default `300000`, i.e. 5 minutes). It compares
   per-table `COUNT(*)`, samples up to 200 rows/table
   (`ONTOLOGY_SHADOW_SAMPLE_ROWS`), status distributions, and relation counts
   for `submittedBy`, `containsItem`, `hasCategory`, `hasInvoice`,
   `hasApproval`, and `hasPaymentReceipt`.
3. Each run logs only aggregate `[ontology-shadow]` counts (difference totals,
   per-kind and per-table counts) to stderr and updates the `shadow` field of
   `GET /ontology/status`. The full diff, including row values, is admin-only
   and never written to stderr.
4. Gate: **24 consecutive hours** with `shadow.equal = true`,
   `outbox.pending = 0`, no dead letters, and no projector crash loops.
   Investigate every difference; do not waive a persistent diff.

   Counts and sampled rows are read sequentially from Postgres and the graph.
   Under continuous writes a single run can report a transient difference (a row
   written between the two reads). Require consecutive clean runs, or run the
   gate during a low-write window, before cutover.

## 5. Cutover

1. Confirm the 24h shadow gate passed on the exact release commit.
2. Set `ONTOLOGY_V2=on` in the API environment and restart the API.
3. Restart the MCP process so ontology tools use the v2 API responses.
4. Verify `/ontology/status`, `/healthz`, and the MCP smoke list again.
5. Watch `outbox.pending`, `outbox.oldestPendingAgeSeconds`, dead letters, and
   graph `counts.quads` for at least one business cycle.

## 6. Rollback

Business writes are never blocked by the projector. To return to the legacy
path:

```bash
# 1) Stop using v2 in every API process.
ONTOLOGY_V2=0

# 2) Stop outbox growth until a projector is intentionally re-enabled.
PGPASSWORD="$DB_PASSWORD" psql \
  -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5433}" \
  -U "${DB_USER:-sse}" -d "${DB_NAME:-sse}" \
  -c "UPDATE ontology_settings SET value='false' WHERE key='outbox_enabled';"

# 3) Restart the API (and MCP).

# 4) After restart with ONTOLOGY_V2=0, rebuild the legacy graph if v2 manual
#    edits must survive the rollback. Manual v2 edits live only in
#    urn:sse:manual / the v2 snapshot and are not written to the legacy OwlStore.
curl -s http://127.0.0.1:3000/ontology/sync \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

The legacy `SemanticMapper` and `executeSparql`/`OwlStore` paths remain intact,
so rollback does not require a data migration. The v2 graph and snapshots can be
left in place; they are additive and rebuildable. Re-enabling `shadow|on` later
runs a reconcile if the graph is stale. Note that the legacy `/ontology/sync`
rebuild reads Postgres; it cannot recover manual v2-only edits, so capture or
re-enter those if rollback must preserve them.

## 7. Troubleshooting

### Outbox lag (`outbox.pending > 0`, `oldestPendingAgeSeconds > 300`)

- Check API logs for `[ontology-projector]` ticks and `[ontology] projector tick
  failed`.
- Confirm **exactly one API replica** is running. Each replica has its own
  in-memory graph and the projector uses `pg_try_advisory_xact_lock(728001)` only
  to serialize drains. If you see the lock held by another process, that other
  replica is draining, and this replica's graph is stale. Stop the extra
  replicas; do not scale the API horizontally until a shared graph store exists.
- Check PostgreSQL for long transactions or trigger errors on mapped tables.
- If the worker respawned, the projector logs a reconcile and rebuilds from the
  latest snapshot/Postgres.
- If lag is expected (bulk import), raise `ONTOLOGY_MAX_OUTBOX_BATCH` and
  `ONTOLOGY_PROJECT_INTERVAL_MS` temporarily, then restore.

### Dead letters

- Alert on `outbox.deadLettered` in `GET /ontology/status` (and on
  `outbox.oldestPendingAgeSeconds > 300`). Page when the dead-letter count is
  non-zero for a sustained period or increases between checks; dead letters are
  never retried automatically.
- Query:
  `SELECT id, table_name, op, attempts, last_error FROM ontology_outbox WHERE dead_letter = true ORDER BY id;`
- **A full reconcile does not clear dead letters.** It rebuilds the graph from
  Postgres but leaves the outbox rows untouched. After fixing the data/mapping
  cause, requeue the specific rows:

  ```sql
  UPDATE ontology_outbox
     SET dead_letter = false, attempts = 0, processed_at = NULL, last_error = NULL
   WHERE id IN (<dead-letter ids>);
  ```

  The projector retries them on the next tick. If the rows are known-irrelevant
  after investigation, delete only those reviewed rows:
  `DELETE FROM ontology_outbox WHERE dead_letter = true AND id IN (<ids>);`
- Do not mark dead letters processed by hand without fixing the cause; the next
  write will fail the same way.

### Worker crashes / timeouts

- A SPARQL timeout terminates and respawns the worker; the adapter restores the
  last checkpoint. `needsRebuild()` triggers a full reconcile on the next tick.
- Check memory (`counts.quads`) and `ONTOLOGY_GRAPH_CALL_TIMEOUT_MS`.
- If crashes repeat, set `ONTOLOGY_V2=0` and investigate before re-enabling.

### Checksum mismatch

- The API refuses to restore a snapshot whose stored checksum does not match the
  N-Quads payload (`Snapshot version N checksum mismatch`).
- Run `POST /ontology/reconcile` to rebuild from Postgres and write a fresh
  snapshot.
- If the mismatch repeats, verify the snapshot table is not being edited by hand
  and that the latest deployment did not change the writer/reading path.

## 8. Decommission

Legacy removal is intentionally deferred until rollback risk is low.

1. Complete the 24h production shadow gate and one clean `on` release.
2. Collect evidence: `shadow.equal = true`, zero pending/dead letters, and a
   successful reconcile checksum.
3. Only then remove the legacy path:
   - `SemanticMapper.syncReportToOntology` / `syncAll` (already deprecated
     no-ops while `ONTOLOGY_V2=on`; `shadow` and `0` still write legacy);
   - `executeSparql` and `OwlStore` (kept during migration so `ONTOLOGY_V2=0`
     rollback works);
   - legacy `/ontology/sync`, `/ontology/query`, `/ontology/graph` branches.
4. Keep `get-engine.ts` for the submit tools and `ensureOntologyLoaded` as long
   as any tool imports them.
5. Do not drop `ontology_snapshots` or legacy ontology data in the same release
   that removes the code. Remove them only after a second clean release and a
   verified backup.
