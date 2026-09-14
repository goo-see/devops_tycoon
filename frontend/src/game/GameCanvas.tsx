/**
 * React wrapper around the Pixi scene (§18, §26). Creates the scene once, keeps
 * it in sync with the snapshot + selection, and destroys it on unmount. Guards
 * against the async `create()` resolving after the component has unmounted.
 */

import { useEffect, useRef } from 'react';
import { GameScene } from './pixi/createGameScene';
import { snapshotToBoardNodes } from './pixi/nodes';
import { useAssetManager } from './assetRuntimeContext';
import { useGameSessionStore, type GameSessionState } from '../state/gameSessionStore';
import type { IncidentSummary, SimulationSnapshot } from '../api/schemas';

/** Sync the scene from a snapshot, isolating any Pixi render error so it can
 * never break the zustand notification chain (which would block React's own
 * store-subscribed re-render). Errors are logged, not thrown (§24). */
function syncScene(
  scene: GameScene,
  snapshot: SimulationSnapshot | null,
  selectedNodeId: string | null,
  incidents: IncidentSummary[],
): void {
  try {
    scene.sync(snapshotToBoardNodes(snapshot), snapshot?.connections ?? []);
    scene.setSelection(selectedNodeId);
    scene.setIncidents(incidents);
  } catch (err) {
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.error('[GameCanvas] scene sync failed:', err);
  }
}

/** Mutable watermark for the event-derived effect bridge (per active session). */
interface EffectBridgeState {
  sessionId: string | null;
  /** Highest event cursor already forwarded to the effect controller. */
  cursor: number;
}

/**
 * Bridge the deduped store event stream + authoritative simulation tick into the
 * scene's event-derived effect runtime (§12, §21). Historical backlog is skipped
 * by seeding the watermark to the current cursor; only strictly-newer events spawn.
 * Isolated so a controller error can never break the zustand notification chain.
 */
function driveEffects(scene: GameScene, state: GameSessionState, bridge: EffectBridgeState): void {
  try {
    if (state.sessionId !== bridge.sessionId) {
      bridge.sessionId = state.sessionId;
      bridge.cursor = state.lastProcessedCursor; // new session → skip prior events
      scene.resetEffects();
    }
    // Advance simulation-time lifetime (expiry) BEFORE spawning new occurrences.
    scene.advanceEffects(state.currentTick);
    for (const ev of state.events) {
      if (ev.cursor > bridge.cursor) {
        scene.handleDomainEvent(ev);
        bridge.cursor = ev.cursor;
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.error('[GameCanvas] effect bridge failed:', err);
  }
}

export function GameCanvas(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GameScene | null>(null);
  const select = useGameSessionStore((s) => s.select);
  const assets = useAssetManager();

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let cancelled = false;

    // Inject the app-scoped manager when present; the scene falls back to a local
    // one otherwise (older callers / isolated tests).
    const createOptions = assets
      ? { onSelect: (id: string | null) => select(id), assets }
      : { onSelect: (id: string | null) => select(id) };

    // Per-mount effect bridge watermark (one subscription per active session, §21).
    const bridge: EffectBridgeState = { sessionId: null, cursor: -1 };

    void GameScene.create(host, createOptions).then((scene) => {
      if (cancelled) {
        scene.destroy();
        return;
      }
      sceneRef.current = scene;
      // Prime with current store state. Isolated like syncScene/driveEffects so a
      // scene error during bootstrap is logged, never an unhandled rejection (§24).
      try {
        const state = useGameSessionStore.getState();
        syncScene(scene, state.snapshot, state.selectedNodeId, state.summary?.active_incidents ?? []);
        // Seed the effect bridge to the current session/cursor so the bootstrap
        // backlog of historical events is not replayed as live effects (§15).
        bridge.sessionId = state.sessionId;
        bridge.cursor = state.lastProcessedCursor;
        scene.advanceEffects(state.currentTick);
      } catch (err) {
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.error('[GameCanvas] scene priming failed:', err);
      }
    });

    // Keep the scene in sync with store changes.
    const unsub = useGameSessionStore.subscribe((state) => {
      const scene = sceneRef.current;
      if (scene === null) return;
      syncScene(scene, state.snapshot, state.selectedNodeId, state.summary?.active_incidents ?? []);
      driveEffects(scene, state, bridge);
    });

    return () => {
      cancelled = true;
      unsub();
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, [select, assets]);

  return (
    <div
      ref={hostRef}
      className="canvas-host"
      role="img"
      aria-label="Isometric infrastructure board. Use the Nodes list for keyboard access."
    />
  );
}
