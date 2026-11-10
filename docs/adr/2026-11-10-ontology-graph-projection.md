# ADR: Ontology graph projection

Status: Accepted
Date: 2026-11-10

## Context
The current ontology mirrors at most 500 reports, misses invoices/rules/categories,
never updates on approval/payment, and uses a non-SPARQL parser.

## Decisions
1. PostgreSQL is the system of record.
2. Row triggers write to ontology_outbox; a projector applies idempotent updates
   to an embedded Oxigraph store owned by the API process.
3. Named graphs: urn:sse:tbox, urn:sse:data, urn:sse:inferred,
   urn:sse:history, urn:sse:manual.
4. sse:status is canonical; legacy report classes are inferred.
5. MCP reads ontology data through the API (thin client).
6. Raw SPARQL is admin/finance only, read-only, timed out, capped.
7. Graph stores identity references, not phone/email/password/storage keys.

## Consequences
- A full rebuild from Postgres is deterministic and checksummed.
- The graph can be swapped for Fuseki/Neo4j behind the GraphStore port.
- A projector outage delays graph freshness but never blocks business writes.
