/**
 * The legacy `GET /ontology/query?type=` and `GET /ontology/entities?type=`
 * contracts returned every match. The v2 query service paginates, so these
 * callers must walk pages instead of silently truncating at the first page.
 */

export const LIST_ALL_PAGE_SIZE = 1000;
export const LIST_ALL_MAX_PAGES = 20;
export const LIST_ALL_MAX_ROWS = 20_000;

export interface EntityListInput {
  type?: string;
  status?: string;
  department?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  scope: any;
}

export interface EntityListPage<T = any> {
  results: T[];
  total: number;
}

export interface EntityListService {
  listEntities(input: EntityListInput): Promise<EntityListPage>;
}

export interface ListAllEntitiesResult<T = any> extends EntityListPage<T> {
  truncated: boolean;
}

/**
 * Fetches every entity match by looping pages until the reported total is
 * reached. A hard cap prevents an unbounded scan if the count query is wrong or
 * the dataset keeps growing between pages; hitting it logs a truncation warning.
 */
export async function listAllEntities<T = any>(
  service: EntityListService,
  input: Omit<EntityListInput, 'page' | 'pageSize'>,
  pageSize = LIST_ALL_PAGE_SIZE,
): Promise<ListAllEntitiesResult<T>> {
  const size = Math.max(1, Math.floor(Number(pageSize) || LIST_ALL_PAGE_SIZE));
  const results: T[] = [];
  let total = 0;
  let page = 1;

  while (page <= LIST_ALL_MAX_PAGES && results.length < LIST_ALL_MAX_ROWS) {
    const current = await service.listEntities({ ...input, page, pageSize: size });
    total = Number.isFinite(current.total) ? current.total : results.length;
    results.push(...(current.results as T[]));

    if (current.results.length === 0 || results.length >= total) break;
    page += 1;
  }

  let truncated = results.length < total;
  if (results.length > LIST_ALL_MAX_ROWS) {
    results.length = LIST_ALL_MAX_ROWS;
    truncated = true;
  }

  if (truncated) {
    console.warn(
      `[ontology] listAllEntities truncated at ${results.length}/${total} rows ` +
        `(type=${input.type ?? '*'}, maxPages=${LIST_ALL_MAX_PAGES}, maxRows=${LIST_ALL_MAX_ROWS})`,
    );
  }

  return { results, total, truncated };
}
