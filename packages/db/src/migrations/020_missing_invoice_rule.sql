-- Mark reports that have expense items but no invoice attachment on any item.
-- Adds a per-report flag node so the condition is visible in the graph.
INSERT INTO reasoning_rules (name, description, conditions, conclusion, priority, is_active, construct_query, severity, message)
VALUES (
  'missing-invoice-flag',
  'Mark reports with items but no invoice attachment',
  '[]'::jsonb,
  '{}'::jsonb,
  60,
  true,
  'PREFIX sse: <https://sse.local/ontology#>
CONSTRUCT {
  ?r a sse:MissingInvoiceReport .
  ?r sse:hasFlag ?flag .
  ?flag a sse:MissingInvoiceFlag ;
        sse:name "缺发票" ;
        sse:description "有明细但没有任何发票附件" .
}
WHERE {
  GRAPH <urn:sse:data> {
    ?r a sse:ExpenseReport ;
       sse:containsItem ?anyItem .
    FILTER NOT EXISTS {
      ?r sse:containsItem ?item .
      ?item sse:hasInvoice ?invoice .
    }
  }
  BIND(IRI(CONCAT("https://sse.local/flag/missing-invoice/", STRAFTER(STR(?r), "report/"))) AS ?flag)
}',
  'warning',
  '缺少发票附件'
)
ON CONFLICT (name) DO NOTHING;
