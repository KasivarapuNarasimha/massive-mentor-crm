export type PaginationInput = {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

export function parsePagination(query: {
  page?: string;
  pageSize?: string;
  limit?: string;
  search?: string;
  sortBy?: string;
  sortDir?: string;
}): Required<Pick<PaginationInput, "page" | "pageSize">> & PaginationInput {
  let page = parseInt(String(query.page || DEFAULT_PAGE), 10);
  if (!Number.isFinite(page) || page < 1) page = DEFAULT_PAGE;

  let pageSize = parseInt(
    String(query.pageSize || query.limit || DEFAULT_PAGE_SIZE),
    10
  );
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

  const sortDir =
    query.sortDir === "asc" || query.sortDir === "desc" ? query.sortDir : "desc";

  return {
    page,
    pageSize,
    search: query.search?.trim() || undefined,
    sortBy: query.sortBy?.trim() || undefined,
    sortDir,
  };
}

export function skipTake(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number
): PaginatedResult<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
