import { monotonicFactory } from 'ulid';

// Monotonic within the process: same-millisecond ids still sort by creation
// order, so ORDER BY id is insertion order — the truth for paging and the
// draft freshness check.
const ulid = monotonicFactory();

export const newId = (): string => ulid();
