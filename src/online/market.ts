import { apiGet, apiSend } from './api.ts';
import type { MarketKind } from './marketRules.ts';

// The marketplace's side of the API (milestone 24; the Worker's
// worker/src/market.ts): browse pages, sharing, Use, reports, and the
// developer's removals. Every call can fail (offline, blocked, refused):
// callers say "Marketplace offline" and the game goes on. ?boards=test uses
// the test items.

export interface MarketItem {
  id: string;
  kind: MarketKind;
  /** A ski or board graphic's type, else ''. */
  type: string;
  title: string;
  /** The board name it was shared under. */
  name: string;
  created: number;
  uses: number;
  /** The slot or outfit in the game's own save formats (marketRules.ts). */
  data: string;
  /** An outfit's look code (look.ts), else ''. */
  look: string;
}

/** A hidden item as the developer sees it. */
export interface HiddenItem extends MarketItem {
  reports: number;
  hiddenAt: number;
}

export type MarketSort = 'new' | 'used';

export interface MarketPage {
  items: MarketItem[];
  /** The cursor for the next page, or null at the end. */
  next: string | null;
}

/** Pages fetched in the last few seconds (the Worker keeps them a minute too), so flicking between filters doesn't re-ask. */
const pages = new Map<string, { at: number; page: MarketPage }>();
const PAGE_MS = 20000;

/** A page of shown items: one kind or all, newest or most used first, or matching a search word (newest first). */
export async function browse(kind: MarketKind | 'all', sort: MarketSort, q: string, after: string | null): Promise<MarketPage> {
  const params: Record<string, string> = { kind, sort };
  if (q) params.q = q;
  if (after) params.after = after;
  const key = JSON.stringify(params);
  const hit = pages.get(key);
  if (hit && performance.now() - hit.at < PAGE_MS) return hit.page;
  const page = await apiGet<MarketPage>('/v1/market', params);
  pages.set(key, { at: performance.now(), page });
  return page;
}

/** Forgets the pages kept here (after sharing, reporting or removing). */
export function forgetPages(): void {
  pages.clear();
}

export interface Share {
  kind: MarketKind;
  type: string;
  title: string;
  name: string;
  data: string;
  look: string;
}

/** Shares an item; its new id. */
export async function share(s: Share): Promise<string> {
  const { id } = await apiSend<{ id: string }>('POST', '/v1/market', s);
  forgetPages();
  return id;
}

/** Counts a Use; the new count (the item's gone: rejects with a 404). */
export async function countUse(id: string): Promise<number> {
  const { uses } = await apiSend<{ uses: number }>('POST', '/v1/market/use', { id });
  return uses;
}

/** Reports an item: whether this report counted (an address makes two a day) and whether the item is now hidden. */
export async function report(id: string): Promise<{ counted: boolean; hidden: boolean }> {
  const r = await apiSend<{ counted: boolean; hidden: boolean }>('POST', '/v1/market/report', { id });
  if (r.hidden) forgetPages();
  return r;
}

/** The developer: deletes an item for good. */
export async function remove(id: string, code: string): Promise<void> {
  await apiSend('POST', '/v1/market/remove', { id, code });
  forgetPages();
}

/** The developer: the items hidden by reports, longest hidden first. */
export async function hiddenItems(code: string): Promise<HiddenItem[]> {
  const { items } = await apiSend<{ items: HiddenItem[] }>('POST', '/v1/market/hidden', { code });
  return items;
}

/** The developer: whether the Worker takes this code (rejects with a 403 when not). */
export async function checkCode(code: string): Promise<void> {
  await apiSend('POST', '/v1/market/dev', { code });
}
