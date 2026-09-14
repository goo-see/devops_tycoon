/**
 * PixiJS isometric scene. Wires the Pixi `Application`, a pannable world
 * container, the explicit scene layers, and incremental building/connection/
 * selection sync. Pure geometry/visual logic lives in `isometric/`, `buildings/`,
 * `assets/`; this file only orchestrates Pixi.
 *
 * Public API is unchanged (`create`/`sync`/`setSelection`/`resize`/`destroy`) so
 * GameCanvas and existing tests keep working. PR B adds:
 *   - explicit layers (SceneLayers)
 *   - footprint + stable depth sorting (BuildingView on a sortable layer)
 *   - node→BuildingRenderModel adapter (unknown-kind safe)
 *   - AssetManager + generated fallback (ownership seam; FE-ART-003 not final)
 *   - diff sync (reuse existing views; create new / destroy gone only)
 *
 * The 128×64 coordinate system (`gridToScreen`/`layoutGrid`) is unchanged.
 */

import { Application, Container, Sprite } from 'pixi.js';
import type { FederatedPointerEvent, Texture } from 'pixi.js';
import { layoutGrid } from './isometric';
import { gridToScreen } from './isometric/coordinates';
import type { BoardNode } from './nodes';
import { SceneLayers } from './scene/sceneLayers';
import { isDebugEnabled, renderDebug } from './scene/debugOverlay';
import { BuildingView } from './buildings/BuildingView';
import { nodeToBuildingModel } from './buildings/nodeBuildingAdapter';
import type { BuildingRenderModel } from './buildings/buildingTypes';
import { ConnectionView } from './connections/ConnectionView';
import { SelectionView } from './selection/SelectionView';
import { AssetManager } from './assets/AssetManager';
import { developmentAssetIdForKind } from './assets/generatedBuildingAsset';
import { incidentsForTarget, type IncidentViewModel } from '../incidentModel';
import type { IncidentSummary, EventEnvelope } from '../../api/schemas';
import {
  EventDerivedEffectController,
  type EffectSprite,
  type EffectLayer,
} from '../effects/EventDerivedEffectController';

export interface GameSceneOptions {
  background?: number;
  onSelect?: (nodeId: string | null) => void;
  debug?: boolean;
  /**
   * App-scoped AssetManager (FE-ART-003). When provided, the scene uses it and
   * NEVER disposes it — shared textures survive scene destroy. Production MUST inject
   * it (via AssetRuntimeProvider); a missing manager is a fail-fast in production.
   */
  assets?: AssetManager;
  /**
   * Explicit opt-in for a scene-OWNED local AssetManager (tests / isolated harnesses
   * only). Without this, an uninjected scene warns in dev and throws in production —
   * so a missing provider can never silently create a per-route manager.
   */
  allowLocalAssetManagerForTests?: boolean;
}

let warnedLocalManager = false;

export class GameScene {
  private readonly app: Application;
  private readonly world: Container;
  private readonly layers: SceneLayers;
  private readonly assets: AssetManager;
  private readonly ownsAssets: boolean;
  private readonly connections: ConnectionView;
  private readonly selectionView: SelectionView;
  private readonly effects: EventDerivedEffectController;
  private readonly buildings = new Map<string, BuildingView>();
  private readonly models = new Map<string, BuildingRenderModel>();
  private readonly viewAssetId = new Map<string, string>();
  private readonly onSelect: ((nodeId: string | null) => void) | undefined;
  private readonly handleResize = (): void => this.recenter();
  private readonly debugEnabled: boolean;

  private selectedId: string | null = null;
  private incidents: readonly IncidentSummary[] = [];
  private destroyed = false;
  private dragging = false;
  private dragStart = { x: 0, y: 0, wx: 0, wy: 0 };

  private constructor(app: Application, options: GameSceneOptions) {
    this.app = app;
    this.onSelect = options.onSelect;
    this.debugEnabled = options.debug ?? isDebugEnabled();
    this.world = new Container();
    this.app.stage.addChild(this.world);
    this.layers = new SceneLayers(this.world, this.debugEnabled);
    // Injected app-scoped manager is shared and NOT disposed by this scene.
    if (options.assets) {
      this.assets = options.assets;
      this.ownsAssets = false;
    } else {
      if (import.meta.env.PROD && !options.allowLocalAssetManagerForTests) {
        throw new Error(
          '[GameScene] AssetManager must be injected in production (wrap the app in AssetRuntimeProvider).',
        );
      }
      if (!options.allowLocalAssetManagerForTests && import.meta.env.DEV && !warnedLocalManager) {
        warnedLocalManager = true;
        // eslint-disable-next-line no-console
        console.warn('[GameScene] no AssetManager injected — creating a scene-local one (tests/dev only).');
      }
      this.assets = new AssetManager();
      this.ownsAssets = true;
      void this.assets.preload();
    }
    this.connections = new ConnectionView(this.layers.get('connections'));
    this.selectionView = new SelectionView(this.layers.get('selection'));

    // Event-derived effect runtime (POLICY-C-FU-002). Lives on the reserved
    // 'effects' layer (same world coord space as buildings), acquires production
    // textures via the scene's AssetManager, and is driven by SIMULATION ticks.
    const effectsLayer = this.layers.get('effects');
    const layer: EffectLayer = {
      addChild: (child) => {
        effectsLayer.addChild(child as unknown as Container);
      },
      removeChild: (child) => {
        effectsLayer.removeChild(child as unknown as Container);
      },
    };
    this.effects = new EventDerivedEffectController({
      assetManager: this.assets,
      layer,
      positionOf: (id) => this.positionOf(id),
      // Pixi Sprite structurally satisfies the minimal EffectSprite contract.
      createSprite: (texture): EffectSprite => new Sprite((texture as Texture | null) ?? undefined),
    });

    // Background panning: drag empty space to move the camera.
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = { contains: () => true };
    this.app.stage.on('pointerdown', this.onBackgroundDown);
    this.app.stage.on('pointermove', this.onBackgroundMove);
    this.app.stage.on('pointerup', this.onBackgroundUp);
    this.app.stage.on('pointerupoutside', this.onBackgroundUp);

    window.addEventListener('resize', this.handleResize);
    this.recenter();
  }

  static async create(container: HTMLElement, options: GameSceneOptions = {}): Promise<GameScene> {
    const app = new Application();
    await app.init({
      background: options.background ?? 0x0f1419,
      resizeTo: container,
      antialias: true,
    });
    container.appendChild(app.canvas);
    return new GameScene(app, options);
  }

  /** Backing AssetManager (shared when injected). Exposed for diagnostics/tests. */
  get assetManager(): AssetManager {
    return this.assets;
  }

  /**
   * Incrementally reconcile the board with a node list + connections. Reuses
   * existing BuildingViews (update in place), creates only new nodes, destroys
   * only removed nodes (§27). Depth is set per building; the buildings layer
   * sorts on change, not every frame.
   */
  sync(nodes: BoardNode[], connections: Array<[string, string]>): void {
    if (this.destroyed) return;
    const layout = layoutGrid(nodes.map((n) => n.id));
    const present = new Set(nodes.map((n) => n.id));
    const buildingLayer = this.layers.get('buildings');

    // Remove gone (destroy releases its asset handle → refCount drops).
    for (const [id, view] of this.buildings) {
      if (!present.has(id)) {
        view.destroy();
        this.buildings.delete(id);
        this.models.delete(id);
        this.viewAssetId.delete(id);
      }
    }

    // Add / update.
    for (const node of nodes) {
      const pos = layout.get(node.id) ?? { x: 0, y: 0 };
      const model = nodeToBuildingModel(node, { col: pos.x, row: pos.y });
      this.models.set(node.id, model);
      const selected = node.id === this.selectedId;
      let view = this.buildings.get(node.id);
      if (!view) {
        view = new BuildingView(model, (nodeId) => this.select(nodeId));
        this.buildings.set(node.id, view);
        buildingLayer.addChild(view.container);
      } else {
        view.update(model, selected);
      }
      view.setSelected(selected);
      view.setIncidents(this.incidentsFor(node.id));
      this.ensureTexture(node.id, model.nodeKind);
    }

    this.connections.sync(connections, (id) => this.positionOf(id));
    this.updateSelectionRing();
    if (this.debugEnabled) renderDebug(this.layers.get('debug'), [...this.models.values()]);
  }

  setSelection(nodeId: string | null): void {
    this.selectedId = nodeId;
    for (const [id, view] of this.buildings) view.setSelected(id === nodeId);
    this.updateSelectionRing();
  }

  /** Apply active incidents to the board. Incidents are deduped per target and are
   * a SEPARATE overlay from node health (never converted into a health value). */
  setIncidents(incidents: readonly IncidentSummary[]): void {
    if (this.destroyed) return;
    this.incidents = incidents;
    for (const [id, view] of this.buildings) view.setIncidents(this.incidentsFor(id));
  }

  resize(): void {
    if (this.destroyed) return;
    this.recenter();
  }

  /**
   * Event-derived effects (POLICY-C-FU-002). GameCanvas bridges the deduped store
   * event stream + the authoritative simulation tick to these three methods:
   *   - advanceEffects(tick): drive simulation-time lifetime (expiry) — call FIRST;
   *   - handleDomainEvent(env): spawn an effect for a mapped occurrence;
   *   - resetEffects(): clear all effects on session change.
   */
  advanceEffects(tick: number): void {
    if (this.destroyed) return;
    this.effects.advanceTo(tick);
  }

  handleDomainEvent(env: EventEnvelope): void {
    if (this.destroyed) return;
    this.effects.handleEvent(env);
  }

  resetEffects(): void {
    if (this.destroyed) return;
    this.effects.reset();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('resize', this.handleResize);
    // Release effect sprites/handles before the app tears down (never destroys the
    // shared texture — that is the AssetManager's to own).
    this.effects.dispose();
    for (const v of this.buildings.values()) v.destroy();
    this.buildings.clear();
    this.models.clear();
    this.connections.destroy();
    this.selectionView.destroy();
    this.viewAssetId.clear();
    // Scene owns Sprites/Graphics/Containers/listeners → destroy with children.
    // Do NOT blanket-destroy textures here: shared/generated textures are owned by
    // the AssetManager (§20, FE-ART-003). Only a scene-OWNED (non-injected) manager
    // is disposed here; an injected app-scoped manager survives scene destroy.
    this.app.destroy(true, { children: true });
    if (this.ownsAssets) void this.assets.disposeAll();
  }

  // -- internals -------------------------------------------------------------

  /** Acquire the development texture for a node's kind and attach it when ready.
   * Only re-acquires when the resolved asset id changes; releases the resolved
   * handle if the view was removed/destroyed before the load settled. */
  private ensureTexture(nodeId: string, kind: BuildingRenderModel['nodeKind']): void {
    const assetId = developmentAssetIdForKind(kind);
    if (this.viewAssetId.get(nodeId) === assetId) return;
    this.viewAssetId.set(nodeId, assetId);
    void this.assets.acquire(assetId).then((handle) => {
      const view = this.buildings.get(nodeId);
      if (this.destroyed || !view || this.viewAssetId.get(nodeId) !== assetId) {
        handle.release();
        return;
      }
      view.setTexture(handle);
    });
  }

  private incidentsFor(nodeId: string): IncidentViewModel[] {
    return this.incidents.length ? incidentsForTarget(this.incidents, nodeId) : [];
  }

  private positionOf(nodeId: string): { x: number; y: number } | undefined {
    const m = this.models.get(nodeId);
    if (!m) return undefined;
    return gridToScreen(m.gridPosition.col, m.gridPosition.row);
  }

  private updateSelectionRing(): void {
    const m = this.selectedId ? this.models.get(this.selectedId) : undefined;
    this.selectionView.show(
      m ? { col: m.gridPosition.col, row: m.gridPosition.row, footprint: m.footprint } : null,
    );
  }

  private select(nodeId: string | null): void {
    this.setSelection(nodeId);
    this.onSelect?.(nodeId);
  }

  private recenter(): void {
    const { width, height } = this.app.renderer;
    this.world.position.set(width / 2, height / 3);
  }

  private readonly onBackgroundDown = (e: FederatedPointerEvent): void => {
    this.dragging = true;
    this.dragStart = { x: e.global.x, y: e.global.y, wx: this.world.x, wy: this.world.y };
  };

  private readonly onBackgroundMove = (e: FederatedPointerEvent): void => {
    if (!this.dragging) return;
    this.world.position.set(
      this.dragStart.wx + (e.global.x - this.dragStart.x),
      this.dragStart.wy + (e.global.y - this.dragStart.y),
    );
  };

  private readonly onBackgroundUp = (): void => {
    this.dragging = false;
  };
}
