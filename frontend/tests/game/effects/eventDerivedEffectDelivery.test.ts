import { describe, expect, it, vi } from 'vitest';
import {
  EventDerivedEffectController,
  type EffectAssetHandle,
} from '../../../src/game/effects/EventDerivedEffectController';
import { buildProductionManifest } from '../../../src/game/pixi/assets/generatedBuildingAsset';
import { occurrenceKey } from '../../../src/game/effects/eventEffectMapping';
import type { EventEnvelope } from '../../../src/api/schemas';

/**
 * Delivery/integration: the effect the runtime consumes must be registered in the
 * production manifest (so AssetManager.acquire resolves it), and a REQUEST_ROUTED
 * EventEnvelope shaped exactly as the backend delivers it (DomainEvent.detail →
 * payload; target == target_node_id) must be consumed by the controller.
 */
describe('event-derived effect delivery', () => {
  it('registers effect.network-flow.primary in the production manifest (canonical checksum)', () => {
    const manifest = buildProductionManifest();
    const entry = manifest.assets.find((a) => a.assetId === 'effect.network-flow.primary');
    expect(entry).toBeDefined();
    expect(entry?.category).toBe('effect');
    expect(entry?.sourceType).toBe('image');
    expect(entry?.source).toBe('/assets/effect/network-flow.png');
    expect(entry?.checksum).toBe('d4c2dd4e7873479cc6ceff00394c28c7149561d468bb0f56d65b257b122b56e9');
    expect(entry?.assetVersion).toBe('1');
    // the four building production assets remain present + unchanged in count
    const buildings = manifest.assets.filter((a) => a.category === 'building' && a.sourceType === 'image');
    expect(buildings).toHaveLength(4);
  });

  it('consumes the backend-shaped REQUEST_ROUTED envelope (target == target_node_id; edge parsed)', async () => {
    const acquired: string[] = [];
    const controller = new EventDerivedEffectController({
      assetManager: {
        acquire: async (assetId): Promise<EffectAssetHandle> => {
          acquired.push(assetId);
          return { texture: { id: assetId }, fallback: false, release: vi.fn() };
        },
      },
      layer: { addChild: vi.fn(), removeChild: vi.fn() },
      positionOf: (id) => (id === 'lb-1' ? { x: 0, y: 0 } : id === 'app-2' ? { x: 10, y: 20 } : undefined),
      createSprite: () => ({
        anchor: { set: vi.fn() },
        position: { set: vi.fn() },
        rotation: 0,
        width: 0,
        height: 0,
        destroy: vi.fn(),
      }),
    });

    // Exactly what backend event_service.envelope() emits for a routed edge.
    const env: EventEnvelope = {
      event_id: 'e1',
      cursor: 1,
      session_id: 's1',
      session_revision: 3,
      tick: 200,
      type: 'REQUEST_ROUTED',
      target: 'app-2', // == payload.target_node_id
      payload: { source_node_id: 'lb-1', target_node_id: 'app-2', count: 30000 },
    };
    expect(env.target).toBe(env.payload['target_node_id']);

    controller.advanceTo(env.tick);
    controller.handleEvent(env);
    await new Promise((r) => setTimeout(r, 0));

    expect(acquired).toEqual(['effect.network-flow.primary']);
    expect(controller.hasOccurrence(occurrenceKey('REQUEST_ROUTED', 200, 'lb-1', 'app-2'))).toBe(true);
    expect(controller.activeCount).toBe(1);
  });
});
