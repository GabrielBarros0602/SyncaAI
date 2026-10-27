/**
 * Reading a whole listing.
 *
 * The API pages by `limit` and `offset` with no total (ADR-0020), so a full page is the only
 * sign that another may follow, and a short one the only sign that none does. A screen that
 * asks once and stops shows the first hundred rows as if they were all of them; the week did
 * exactly that until the audit of 2026-10-24.
 */
import { api } from "./client";
import type { Page } from "./types";

/** The server's ceiling on a page (`MAX_PAGE_SIZE`). Asking for less would only cost requests. */
export const PAGE_SIZE = 100;

/**
 * Every item of a listing, in the server's order, asking for the next page until one comes
 * back short.
 *
 * The pages are read at different instants. A row created ahead of the offset between two
 * reads pushes one already seen into the next page: it is kept once, where it first came. A
 * row deleted between them pulls one back into a page already read, and that one stays
 * unseen until the next reload. Accepted rather than solved with a cursor, whose trigger in
 * ADR-0020 is a measurement.
 */
export async function everyPage<T extends { id: string }>(path: string): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const items = new Map<string, T>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await api.get<Page<T>>(
      `${path}${separator}limit=${String(PAGE_SIZE)}&offset=${String(offset)}`,
    );
    const before = items.size;
    for (const item of page.items) {
      if (!items.has(item.id)) items.set(item.id, item);
    }
    // A full page that brings nothing new is a server not moving forward. Stopping is better
    // than asking for ever.
    if (page.items.length < PAGE_SIZE || items.size === before) return [...items.values()];
  }
}
