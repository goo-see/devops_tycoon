/**
 * Generated DEVELOPMENT building assets (§16). Code-drawn canvas silhouettes — NOT
 * final production art, NOT reproductions of any reference building. Each node
 * kind gets a distinct SILHOUETTE + GLYPH + LABEL (not colour alone), so Redis and
 * PostgreSQL are distinguishable without relying on hue. Same assetId → shared
 * texture (the manager caches by assetId@version; nothing here is per-node).
 *
 * These are marked DEVELOPMENT_PLACEHOLDER_NOT_FINAL_ART and carry no production
 * approval — ASSET-OPS-001 rights/approval is a separate, later gate.
 */

import type { NodeKind } from '../../../api/schemas';
import type { AssetManifest, AssetManifestEntry } from './assetTypes';
import { DEVELOPMENT_PLACEHOLDER_NOT_FINAL_ART } from '../buildings/buildingTypes';

/** Silhouette family — a non-colour cue distinguishing kinds. */
export type BuildingSilhouette = 'router' | 'box' | 'cylinder' | 'stack' | 'unknown';

export interface BuildingAssetSpec {
  assetId: string;
  label: string;
  glyph: string;
  silhouette: BuildingSilhouette;
  bg: string;
  fg: string;
  /** Marker so reviewers can grep-confirm these are not final art. */
  readonly kind: typeof DEVELOPMENT_PLACEHOLDER_NOT_FINAL_ART;
}

/**
 * Node kind → stable canonical asset id. The id is manifest-driven: in DEV each is a
 * `generated` placeholder; in PRODUCTION a kind may be served as a real `image` asset
 * under the SAME id. `app_server` (#001) and `postgresql` (#002) are gated production
 * image assets; the others remain dev placeholders until their own production assets
 * pass the gate.
 */
export const NODE_BUILDING_ASSET_ID: Record<NodeKind, string> = {
  load_balancer: 'building.load-balancer.primary',
  app_server: 'building.app-server.primary',
  redis: 'building.cache.primary',
  postgresql: 'building.database.primary',
};

export const UNKNOWN_BUILDING_ASSET_ID = 'building.unknown.generated';
export const UNIVERSAL_FALLBACK_ASSET_ID = 'fallback.universal.generated';

const SPECS: Record<string, Omit<BuildingAssetSpec, 'assetId' | 'kind'>> = {
  [NODE_BUILDING_ASSET_ID.load_balancer]: { label: 'LB', glyph: '⇄', silhouette: 'router', bg: '#243b53', fg: '#bcd8f5' },
  [NODE_BUILDING_ASSET_ID.app_server]: { label: 'APP', glyph: '▣', silhouette: 'box', bg: '#26402a', fg: '#c7e8cb' },
  [NODE_BUILDING_ASSET_ID.redis]: { label: 'REDIS', glyph: '◆', silhouette: 'cylinder', bg: '#4a2c22', fg: '#ffd2bd' },
  [NODE_BUILDING_ASSET_ID.postgresql]: { label: 'DB', glyph: '⛁', silhouette: 'stack', bg: '#2f2a4a', fg: '#d6cfff' },
  [UNKNOWN_BUILDING_ASSET_ID]: { label: 'UNKNOWN', glyph: '?', silhouette: 'unknown', bg: '#3a4149', fg: '#c9d2db' },
  [UNIVERSAL_FALLBACK_ASSET_ID]: { label: 'MISSING', glyph: '▢', silhouette: 'unknown', bg: '#8b98a6', fg: '#1b2b3a' },
};

/** Resolve a development spec for any known dev/fallback asset id (else universal). */
export function buildingAssetSpec(assetId: string): BuildingAssetSpec {
  const base = SPECS[assetId] ?? SPECS[UNIVERSAL_FALLBACK_ASSET_ID]!;
  return { assetId, kind: DEVELOPMENT_PLACEHOLDER_NOT_FINAL_ART, ...base };
}

export function developmentAssetIdForKind(kind: NodeKind | 'unknown'): string {
  return kind === 'unknown' ? UNKNOWN_BUILDING_ASSET_ID : NODE_BUILDING_ASSET_ID[kind];
}

/**
 * A development runtime manifest for the generated placeholder assets. Every kind
 * falls back to the unknown building, which falls back to the universal fallback
 * (chain depth ≤ 3, no cycles). These are `generated` source-type entries with a
 * DEVELOPMENT metadata marker — NOT production-approved art.
 */
export function buildDevelopmentManifest(version = 'dev-1'): AssetManifest {
  const devMeta = { development: true, marker: DEVELOPMENT_PLACEHOLDER_NOT_FINAL_ART };
  const entry = (assetId: string, fallbackAssetId?: string): AssetManifestEntry => ({
    assetId,
    category: assetId.startsWith('fallback') ? 'fallback' : 'building',
    sourceType: 'generated',
    assetVersion: version,
    anchor: { x: 0.5, y: 1 },
    footprint: { width: 1, height: 1 },
    metadata: devMeta,
    ...(fallbackAssetId ? { fallbackAssetId } : {}),
  });
  return {
    manifestVersion: version,
    // Kind entries carry no per-entry fallback → the building category fallback
    // (tier 2) resolves them to the unknown building, then universal (tier 3).
    assets: [
      entry(NODE_BUILDING_ASSET_ID.load_balancer),
      entry(NODE_BUILDING_ASSET_ID.app_server),
      entry(NODE_BUILDING_ASSET_ID.redis),
      entry(NODE_BUILDING_ASSET_ID.postgresql),
      entry(UNKNOWN_BUILDING_ASSET_ID, UNIVERSAL_FALLBACK_ASSET_ID),
      entry(UNIVERSAL_FALLBACK_ASSET_ID),
    ],
    categoryFallbacks: {
      building: UNKNOWN_BUILDING_ASSET_ID,
      fallback: UNIVERSAL_FALLBACK_ASSET_ID,
    },
  };
}

/**
 * Approved production IMAGE assets, keyed by canonical asset id. Each `source` is the
 * served static PNG; each `checksum` is the canonical `checksum_sha256` from the asset's
 * metadata (verified by the AssetManager on load). Add an entry here when a candidate
 * passes the First Production Image Asset Gate.
 *   #001 APP Server Building · #002 Database Building
 */
export const PRODUCTION_IMAGE_ASSETS: Record<string, { source: string; checksum: string }> = {
  [NODE_BUILDING_ASSET_ID.app_server]: {
    source: '/assets/building/app-server.png',
    checksum: '5507a77ce21c11eb427d03a44a95a4fe32f906e8be43bb6fe0dc7286af894e96',
  },
  [NODE_BUILDING_ASSET_ID.postgresql]: {
    source: '/assets/building/database.png',
    checksum: '1fa594411c7949d5427d9ca4178631bcff6c9fb44724e05a6d79d859f7f1557d',
  },
  [NODE_BUILDING_ASSET_ID.redis]: {
    source: '/assets/building/cache.png',
    checksum: 'c8b04ee398af791b3ef5f3edd324d15f9dd226d14f39006d99eb92adc3559d35',
  },
  [NODE_BUILDING_ASSET_ID.load_balancer]: {
    source: '/assets/building/load-balancer.png',
    checksum: '02f2545655c6fbe2bb3c4f6399bd57b07d45a5c00fd99d20f0a19d71db6aa9ff',
  },
};

// Back-compat named exports (candidate #001).
export const PRODUCTION_APP_SERVER_SOURCE = PRODUCTION_IMAGE_ASSETS[NODE_BUILDING_ASSET_ID.app_server]!.source;
export const PRODUCTION_APP_SERVER_CHECKSUM = PRODUCTION_IMAGE_ASSETS[NODE_BUILDING_ASSET_ID.app_server]!.checksum;

/**
 * Approved production EFFECT assets (category `effect`), keyed by canonical asset id.
 * These are not per-NodeKind — they are acquired on demand by the event-derived
 * effect runtime (POLICY-C-FU-002), not by building sync. The served PNG + checksum
 * are the candidate #005 canonical resource; the asset itself is UNCHANGED here (this
 * only registers it into the runtime manifest so `AssetManager.acquire` resolves it).
 *   #005 Network Flow Effect
 */
export const PRODUCTION_EFFECT_ASSETS: Record<string, { source: string; checksum: string }> = {
  'effect.network-flow.primary': {
    source: '/assets/effect/network-flow.png',
    checksum: 'd4c2dd4e7873479cc6ceff00394c28c7149561d468bb0f56d65b257b122b56e9',
  },
};

/**
 * Runtime PRODUCTION manifest. Identical to the development manifest except each kind
 * with an approved production IMAGE asset (see `PRODUCTION_IMAGE_ASSETS`) is served as a
 * real `image` entry (checksum-verified by ProductionImageAssetLoader). Kinds without a
 * production asset remain generated placeholders. The generated fallback chain
 * (building → unknown → universal) still applies if an image ever fails to load.
 */
export function buildProductionManifest(version = 'prod-1'): AssetManifest {
  const dev = buildDevelopmentManifest(version);
  const assets = dev.assets.map((e): AssetManifestEntry => {
    const prod = PRODUCTION_IMAGE_ASSETS[e.assetId];
    return prod
      ? {
          assetId: e.assetId,
          category: 'building',
          sourceType: 'image',
          source: prod.source,
          checksum: prod.checksum,
          assetVersion: '1',
          anchor: { x: 0.5, y: 1 },
          footprint: { width: 1, height: 1 },
        }
      : e;
  });
  // Approved production effect assets (not NodeKind-bound; acquired by the
  // event-derived effect runtime). Appended as canonical `effect`/`image` entries.
  const effectEntries: AssetManifestEntry[] = Object.entries(PRODUCTION_EFFECT_ASSETS).map(
    ([assetId, prod]): AssetManifestEntry => ({
      assetId,
      category: 'effect',
      sourceType: 'image',
      source: prod.source,
      checksum: prod.checksum,
      assetVersion: '1',
    }),
  );
  return {
    manifestVersion: version,
    assets: [...assets, ...effectEntries],
    ...(dev.categoryFallbacks ? { categoryFallbacks: dev.categoryFallbacks } : {}),
  };
}

const SIZE = 128;

function drawSilhouette(ctx: CanvasRenderingContext2D, s: BuildingSilhouette): void {
  ctx.beginPath();
  const cx = SIZE / 2;
  switch (s) {
    case 'router': // wide low block with two arrows implied by shape
      ctx.moveTo(24, 78);
      ctx.lineTo(cx, 58);
      ctx.lineTo(104, 78);
      ctx.lineTo(cx, 98);
      ctx.closePath();
      break;
    case 'box': // upright cube
      ctx.rect(42, 44, 44, 48);
      break;
    case 'cylinder': // rounded tank (redis)
      ctx.ellipse(cx, 52, 26, 12, 0, 0, Math.PI * 2);
      ctx.rect(38, 52, 52, 40);
      break;
    case 'stack': // stacked disks (db)
      ctx.ellipse(cx, 50, 30, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(cx, 68, 30, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(cx, 86, 30, 12, 0, 0, Math.PI * 2);
      break;
    default: // unknown → dashed square handled by border
      ctx.rect(40, 44, 48, 48);
  }
  ctx.fill();
}

/** Draw the development building onto a 2D canvas. Safe when no 2d ctx (jsdom). */
export function drawBuildingAsset(canvas: HTMLCanvasElement, spec: BuildingAssetSpec): void {
  canvas.width = SIZE;
  canvas.height = SIZE;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return;
  ctx.clearRect(0, 0, SIZE, SIZE);
  // Silhouette body.
  ctx.fillStyle = spec.bg;
  drawSilhouette(ctx, spec.silhouette);
  // Outline (dashed for unknown/fallback as a non-colour "not final / missing" cue).
  ctx.strokeStyle = spec.fg;
  ctx.lineWidth = 2;
  if (spec.silhouette === 'unknown') ctx.setLineDash([6, 4]);
  ctx.strokeRect(20, 20, SIZE - 40, SIZE - 40);
  ctx.setLineDash([]);
  // Glyph + label (non-colour cues).
  ctx.fillStyle = spec.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 34px monospace';
  ctx.fillText(spec.glyph, cxHalf(), 30);
  ctx.font = 'bold 14px monospace';
  ctx.fillText(spec.label, cxHalf(), SIZE - 16);
}

function cxHalf(): number {
  return SIZE / 2;
}
