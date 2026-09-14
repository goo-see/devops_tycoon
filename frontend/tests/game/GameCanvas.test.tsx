import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('pixi.js', async () => await import('../helpers/fakePixi'));

const sceneMock = {
  sync: vi.fn(),
  setSelection: vi.fn(),
  setIncidents: vi.fn(),
  advanceEffects: vi.fn(),
  handleDomainEvent: vi.fn(),
  resetEffects: vi.fn(),
  destroy: vi.fn(),
};
const createMock = vi.fn().mockResolvedValue(sceneMock);

vi.mock('../../src/game/pixi/createGameScene', () => ({
  GameScene: { create: (...args: unknown[]) => createMock(...args) },
}));

import { GameCanvas } from '../../src/game/GameCanvas';

describe('GameCanvas', () => {
  it('creates the scene on mount and destroys it on unmount (§26)', async () => {
    const { unmount } = render(<GameCanvas />);
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    await waitFor(() => expect(sceneMock.sync).toHaveBeenCalled());
    unmount();
    expect(sceneMock.destroy).toHaveBeenCalled();
  });
});
