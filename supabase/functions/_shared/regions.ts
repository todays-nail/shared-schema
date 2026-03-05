import { supabaseAdmin } from "./supabase.ts";

export type RegionRow = {
  id: string;
  name: string;
  parent_id: string | null;
  level: number | null;
};

export type RegionNode = {
  id: string;
  name: string;
  parent_id: string | null;
  level: number | null;
  service_scope_id: string;
  children: RegionNode[];
};

export type RegionBoundaryRow = {
  region_id: string;
  geometry: Record<string, unknown>;
  bbox: unknown;
  center: unknown;
  source: string;
  source_version: string;
  synced_at: string;
};

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

export function compareKoName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "ko");
}

function normalizeRows(rows: RegionRow[]): RegionRow[] {
  return rows.map((row) => ({
    id: row.id.toLowerCase(),
    name: row.name,
    parent_id: row.parent_id?.toLowerCase() ?? null,
    level: row.level,
  }));
}

export function resolveServiceScopeId(row: RegionRow): string {
  const level = row.level ?? 0;

  if (!row.parent_id) {
    return row.id;
  }

  // 상세 선택(예: 경기도 수원시 장안구)은 서비스 단위(수원시)로 승격한다.
  if (level >= 3) {
    return row.parent_id;
  }

  return row.id;
}

export function buildRegionTree(rawRows: RegionRow[]): RegionNode[] {
  const rows = normalizeRows(rawRows);
  const childrenByParent = new Map<string, RegionRow[]>();

  for (const row of rows) {
    if (!row.parent_id) continue;
    const children = childrenByParent.get(row.parent_id) ?? [];
    children.push(row);
    childrenByParent.set(row.parent_id, children);
  }

  const toNode = (row: RegionRow): RegionNode => {
    const children = (childrenByParent.get(row.id) ?? [])
      .sort(compareKoName)
      .map(toNode);

    return {
      id: row.id,
      name: row.name,
      parent_id: row.parent_id,
      level: row.level,
      service_scope_id: resolveServiceScopeId(row),
      children,
    };
  };

  return rows
    .filter((row) => row.parent_id === null)
    .sort(compareKoName)
    .map(toNode);
}

export function buildRegionLookup(rawRows: RegionRow[]): Map<string, RegionRow> {
  const rows = normalizeRows(rawRows);
  return new Map(rows.map((row) => [row.id, row]));
}

export function buildRegionLabel(regionId: string, lookup: Map<string, RegionRow>): string | null {
  const normalized = regionId.toLowerCase();
  if (!lookup.has(normalized)) return null;

  const parts: string[] = [];
  const guard = new Set<string>();
  let cursor: string | null = normalized;

  while (cursor) {
    if (guard.has(cursor)) break;
    guard.add(cursor);

    const row = lookup.get(cursor);
    if (!row) break;
    parts.push(row.name);
    cursor = row.parent_id;
  }

  if (parts.length === 0) return null;
  return parts.reverse().join(" ");
}

export function resolveBoundaryWithParentFallback(
  requestedRegionId: string,
  lookup: Map<string, RegionRow>,
  boundaries: Map<string, RegionBoundaryRow>,
): RegionBoundaryRow | null {
  let cursor: string | null = requestedRegionId.toLowerCase();
  const guard = new Set<string>();

  while (cursor) {
    if (guard.has(cursor)) break;
    guard.add(cursor);

    const boundary = boundaries.get(cursor);
    if (boundary) {
      return boundary;
    }

    const row = lookup.get(cursor);
    if (!row) break;
    cursor = row.parent_id;
  }

  return null;
}

export async function fetchAllRegions(): Promise<RegionRow[]> {
  const { data, error } = await supabaseAdmin
    .from("regions")
    .select("id, name, parent_id, level")
    .limit(7000);

  if (error) {
    throw new Error(`regions lookup failed: ${error.message}`);
  }

  return (data ?? []) as RegionRow[];
}

export async function fetchBoundariesByRegionIds(regionIds: string[]): Promise<RegionBoundaryRow[]> {
  if (regionIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("region_boundaries")
    .select("region_id, geometry, bbox, center, source, source_version, synced_at")
    .in("region_id", regionIds);

  if (error) {
    throw new Error(`region_boundaries lookup failed: ${error.message}`);
  }

  return ((data ?? []) as RegionBoundaryRow[]).map((row) => ({
    ...row,
    region_id: row.region_id.toLowerCase(),
  }));
}

export async function fetchLatestRegionSyncMeta(): Promise<{ source_version: string; synced_at: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("region_sync_meta")
    .select("source_version, synced_at")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // region_sync_meta가 아직 없는 환경은 null로 처리한다.
    return null;
  }

  if (!data) return null;
  return {
    source_version: (data as { source_version: string }).source_version,
    synced_at: (data as { synced_at: string }).synced_at,
  };
}
