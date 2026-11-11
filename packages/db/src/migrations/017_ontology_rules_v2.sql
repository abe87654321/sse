-- Phase 4: CONSTRUCT rules and constraint metadata.
--
-- `construct_query` holds a SPARQL CONSTRUCT that materializes conclusions into
-- urn:sse:inferred. `severity`/`message` let validation and anomaly output carry
-- operator-facing metadata without a second lookup.
ALTER TABLE reasoning_rules ADD COLUMN IF NOT EXISTS construct_query TEXT;
ALTER TABLE reasoning_rules ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';
ALTER TABLE reasoning_rules ADD COLUMN IF NOT EXISTS message TEXT;

-- Preflight for databases that already contain duplicate rule names from the
-- older unconstrained seed. Keep the lowest UUID id and delete the rest so the
-- unique index below can be created. This is safe because nothing references
-- reasoning_rules(id) with a foreign key.
DELETE FROM reasoning_rules a
 USING reasoning_rules b
 WHERE a.name = b.name
   AND a.id > b.id;

-- Seed idempotency relies on a named unique constraint. Without it, re-running
-- this migration (or any future seed touching the same name) would append
-- duplicate legacy rules, which then match with the same priority.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reasoning_rules_name ON reasoning_rules(name);

-- Legacy report classes are inferred from the canonical sse:status literal.
-- Do NOT seed a governedBy CONSTRUCT rule: amount/category matching has
-- precedence rules that are implemented in the shared TypeScript matchRule
-- function (and only optionally cross-checked against the graph).
INSERT INTO reasoning_rules (name, description, conditions, conclusion, priority, is_active, construct_query, severity, message)
VALUES
('legacy-status-draft',
 'Infer legacy DraftReport class from status',
 '{}'::jsonb, '{}'::jsonb, 10, true,
 'CONSTRUCT { ?r a <https://sse.local/ontology#DraftReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "draft" } }',
 'info', 'draft report'),
('legacy-status-pending',
 'Infer legacy PendingReport class from status',
 '{}'::jsonb, '{}'::jsonb, 20, true,
 'CONSTRUCT { ?r a <https://sse.local/ontology#PendingReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "pending" } }',
 'info', 'pending report'),
('legacy-status-approved',
 'Infer legacy ApprovedReport class from status',
 '{}'::jsonb, '{}'::jsonb, 30, true,
 'CONSTRUCT { ?r a <https://sse.local/ontology#ApprovedReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "approved" } }',
 'info', 'approved report'),
('legacy-status-rejected',
 'Infer legacy RejectedReport class from status',
 '{}'::jsonb, '{}'::jsonb, 40, true,
 'CONSTRUCT { ?r a <https://sse.local/ontology#RejectedReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "rejected" } }',
 'info', 'rejected report'),
('legacy-status-paid',
 'Infer legacy PaidReport class from status',
 '{}'::jsonb, '{}'::jsonb, 50, true,
 'CONSTRUCT { ?r a <https://sse.local/ontology#PaidReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "paid" } }',
 'info', 'paid report')
ON CONFLICT (name) DO NOTHING;
