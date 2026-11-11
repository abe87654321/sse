-- ============================================================================
-- SSE Ontology v2 — production cutover preflight (READ ONLY)
-- ============================================================================
-- Purpose : collect the evidence required before the ontology v2 cutover.
-- Safety  : every statement below is a SELECT (or a session SET). The session
--           is forced read-only so an accidental write fails instead of
--           touching production data.
-- Client  : psql (uses \gset / \if / \echo). Do not run through a client that
--           strips backslash meta-commands.
--
-- Usage:
--   psql "host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER" \
--     -v ON_ERROR_STOP=1 -f deploy/preflight-ontology-v2.sql
--
-- Interpretation:
--   * Section 1    -> all four versions must report applied = true.
--   * Section 2    -> total_affected must be 0 before cutover.
--   * Section 3    -> has_legacy_default_hash / has_current_seed_hash must be
--                     false; rotate admin123 first.
--   * Section 4    -> outbox_enabled must be false before the first shadow
--                     boot; pending = 0, dead_letter = 0 during the 24h gate.
--   * Section 5    -> graph counts come from GET /ontology/status, not SQL.
--   * Section 6    -> duplicate rule names must be zero after migration 017.
--   * Section 7    -> manual graph edits cannot be verified from SQL.
-- ============================================================================

\set ON_ERROR_STOP on
SET default_transaction_read_only = on;
SET statement_timeout = '30s';

-- ============================================================================
-- 1. APPLIED MIGRATIONS
-- Expected versions for ontology v2 and the sentinel repair.
-- ============================================================================

SELECT to_regclass('public.schema_migrations') IS NOT NULL AS has_schema_migrations \gset
\if :has_schema_migrations
WITH expected(version) AS (
  VALUES
    ('015_ontology_graph_snapshots'),
    ('016_ontology_outbox'),
    ('017_ontology_rules_v2'),
    ('018_disable_external_password_sentinels')
)
SELECT e.version,
       (m.version IS NOT NULL) AS applied,
       m.applied_at
FROM expected e
LEFT JOIN schema_migrations m ON m.version = e.version
ORDER BY e.version;

-- Missing versions only. An empty result means all four are applied.
WITH expected(version) AS (
  VALUES
    ('015_ontology_graph_snapshots'),
    ('016_ontology_outbox'),
    ('017_ontology_rules_v2'),
    ('018_disable_external_password_sentinels')
)
SELECT e.version AS missing_version
FROM expected e
LEFT JOIN schema_migrations m ON m.version = e.version
WHERE m.version IS NULL
ORDER BY e.version;
\else
\echo 'FAIL: schema_migrations is missing; no migrations have been applied.'
\endif

-- ============================================================================
-- 2. PASSWORD HYGIENE
-- Sentinel / empty / whitespace-only hashes cannot log in. List ids and
-- phones only — never print password_hash values.
-- ============================================================================

SELECT
  COUNT(*) FILTER (
    WHERE password_hash IN ('', '!', 'scim_managed_no_pwd', 'mdm_managed_no_pwd')
  ) AS sentinel_hashes,
  COUNT(*) FILTER (
    WHERE password_hash ~ '^\s*$'
  ) AS whitespace_hashes,
  COUNT(*) FILTER (
    WHERE password_hash IN ('', '!', 'scim_managed_no_pwd', 'mdm_managed_no_pwd')
       OR password_hash ~ '^\s*$'
  ) AS total_affected,
  COUNT(*) AS total_users
FROM users;

-- Affected accounts (ids/phones only; no hashes).
SELECT id, phone, status, deleted_at
FROM users
WHERE password_hash IN ('', '!', 'scim_managed_no_pwd', 'mdm_managed_no_pwd')
   OR password_hash ~ '^\s*$'
ORDER BY phone;

-- ============================================================================
-- 3. DEFAULT ADMIN
-- 13800000000 / admin123 ships in the seed. Any true flag below means the
-- default credential is still present and MUST be rotated before cutover.
--   * has_legacy_default_hash   = pre-repair seed hash (old releases)
--   * has_current_seed_hash     = current 001_initial.sql seed hash
-- ============================================================================

SELECT id, phone, status, deleted_at,
       (password_hash = '$2b$10$CrmgV1BBcfaDFF7m5uIUf.5zk/JK8BvMgUP4M5Ock0KOgAmZDvgMq')
         AS has_legacy_default_hash,
       (password_hash = '$2b$10$eILf0FOaUu3MyMoa/J93SuV2hnBaL7XcNO7/ye9H7AGkYceJs9OSK')
         AS has_current_seed_hash
FROM users
WHERE phone = '13800000000';

-- ============================================================================
-- 4. ONTOLOGY STATE
-- Requires migrations 015/016. Skipped with a message when the tables are
-- missing so this script is still safe to run before the migrations.
-- ============================================================================

SELECT to_regclass('public.ontology_settings') IS NOT NULL
   AND to_regclass('public.ontology_outbox') IS NOT NULL
   AND to_regclass('public.ontology_projector_state') IS NOT NULL
   AND to_regclass('public.ontology_graph_snapshots') IS NOT NULL
   AS has_ontology_state \gset
\if :has_ontology_state

-- 4a. Outbox gate. Must be 'false' before the first shadow boot; the projector
--     enables it after TBox load, snapshot restore/reconcile and runner.start().
SELECT key, value, updated_at
FROM ontology_settings
WHERE key = 'outbox_enabled';

-- 4b. Outbox backlog. pending and dead_letter must both be 0 for the cutover
--     gate; oldest_pending_age_seconds should stay below 300 while ONTOLOGY_V2=on.
SELECT
  COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_letter = false) AS pending,
  COUNT(*) FILTER (WHERE dead_letter = true) AS dead_letter,
  COUNT(*) FILTER (
    WHERE processed_at IS NULL
      AND dead_letter = false
      AND attempts > 0
      AND occurred_at > NOW() - INTERVAL '1 hour'
  ) AS failures_last_hour,
  COALESCE(
    EXTRACT(EPOCH FROM (
      NOW() - MIN(occurred_at) FILTER (
        WHERE processed_at IS NULL AND dead_letter = false
      )
    )),
    0
  ) AS oldest_pending_age_seconds
FROM ontology_outbox;

-- 4c. Projector watermarks.
SELECT id, last_outbox_id, last_snapshot_version, updated_at
FROM ontology_projector_state
WHERE id = 'default';

-- 4d. Latest persisted snapshot (version / checksum).
SELECT version, checksum, last_outbox_id, created_at
FROM ontology_graph_snapshots
ORDER BY version DESC
LIMIT 1;

\else
\echo 'SKIP: ontology state tables missing (migrations 015/016 not applied).'
\endif

-- ============================================================================
-- 5. ENTITY COUNTS vs SQL COUNTS
-- One simple COUNT(*) per mapped table. The matching graph counts are returned
-- by GET /ontology/status (counts.*); this SQL is only the source-of-truth side
-- of the shadow comparison. Compare them before trusting shadow.equal = true.
-- ============================================================================

SELECT table_name, row_count
FROM (
  SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
  UNION ALL
  SELECT 'expense_categories', COUNT(*) FROM expense_categories
  UNION ALL
  SELECT 'expense_reports', COUNT(*) FROM expense_reports
  UNION ALL
  SELECT 'expense_items', COUNT(*) FROM expense_items
  UNION ALL
  SELECT 'invoices', COUNT(*) FROM invoices
  UNION ALL
  SELECT 'approval_rules', COUNT(*) FROM approval_rules
  UNION ALL
  SELECT 'approval_records', COUNT(*) FROM approval_records
  UNION ALL
  SELECT 'payment_receipts', COUNT(*) FROM payment_receipts
) counts
ORDER BY table_name;

-- ============================================================================
-- 6. RULE SEED
-- Active CONSTRUCT rules drive urn:sse:inferred materialization. Duplicate
-- names must be zero after migration 017 created uq_reasoning_rules_name.
-- ============================================================================

SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'reasoning_rules'
    AND column_name = 'construct_query'
) AS has_construct_query \gset
\if :has_construct_query
SELECT
  COUNT(*) FILTER (WHERE is_active AND construct_query IS NOT NULL) AS active_construct_rules,
  COUNT(*) FILTER (WHERE construct_query IS NOT NULL) AS total_construct_rules,
  COUNT(*) AS total_rules
FROM reasoning_rules;

-- Duplicate names keep the lowest UUID id during migration 017. Must be empty.
SELECT name, COUNT(*) AS copies, MIN(id) AS keep_id
FROM reasoning_rules
GROUP BY name
HAVING COUNT(*) > 1
ORDER BY copies DESC, name;
\else
\echo 'SKIP: reasoning_rules.construct_query missing (migration 017 not applied).'
\endif

-- ============================================================================
-- 7. HISTORY / MANUAL GRAPH EDITS (NOT CHECKABLE FROM SQL)
-- ============================================================================
-- Manual v2 edits (PUT/DELETE /ontology/entity, /ontology/relation,
-- /ontology/from-text) are written to urn:sse:manual and the v2 snapshot only.
-- They are NOT mirrored into the legacy OwlStore, and they do not appear in the
-- mapped-table COUNT(*) above. Before cutover:
--   * capture any manual v2 edits (or confirm none exist) so they can be
--     re-entered if a rollback to the legacy path is required;
--   * remember that a legacy GET /ontology/sync rebuild reads Postgres and
--     cannot recover manual v2-only edits.
-- Use GET /ontology/status and the admin UI/API to review manual entities; SQL
-- cannot tell you whether an entity came from a row trigger or a manual edit.
-- ============================================================================
