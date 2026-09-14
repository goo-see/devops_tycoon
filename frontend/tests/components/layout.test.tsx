import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// GameLayout mounts GameCanvas → mock the Pixi scene so no WebGL is needed.
// Must implement the full GameScene surface GameCanvas drives (sync/selection/
// incidents + the event-derived effect bridge) or priming throws.
vi.mock('../../src/game/pixi/createGameScene', () => ({
  GameScene: {
    create: vi.fn().mockResolvedValue({
      sync: vi.fn(),
      setSelection: vi.fn(),
      setIncidents: vi.fn(),
      advanceEffects: vi.fn(),
      handleDomainEvent: vi.fn(),
      resetEffects: vi.fn(),
      destroy: vi.fn(),
    }),
  },
}));

import { GameLayout } from '../../src/components/layout/GameLayout';
import { LeftNavigation } from '../../src/components/layout/LeftNavigation';
import { ControllerProvider } from '../../src/session/controllerContext';
import type { GameSessionController } from '../../src/session/controller';
import { useGameSessionStore } from '../../src/state/gameSessionStore';
import { useConnectionStore } from '../../src/state/connectionStore';
import { makeSnapshot, makeSummary } from '../helpers/factories';

function renderLayout() {
  const controller = { runCommand: vi.fn().mockResolvedValue(null) } as unknown as GameSessionController;
  useGameSessionStore.setState({ sessionId: 'sess-1234abcd', summary: makeSummary(), snapshot: makeSnapshot() });
  return render(
    <ControllerProvider controller={controller}>
      <GameLayout />
    </ControllerProvider>,
  );
}

describe('GameLayout shell', () => {
  beforeEach(() => {
    useGameSessionStore.getState().reset();
    useConnectionStore.getState().reset();
  });

  it('renders semantic landmarks: header, nav, main, aside', () => {
    renderLayout();
    expect(screen.getByRole('banner')).toBeInTheDocument(); // <header>
    expect(screen.getByRole('navigation', { name: 'Campus sections' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'campus-main');
    expect(screen.getByRole('complementary', { name: 'Context panel' })).toBeInTheDocument();
  });

  it('shows the brand and HUD, and no unimplemented Level/Score', () => {
    renderLayout();
    expect(screen.getByLabelText('DevOps Tycoon')).toBeInTheDocument();
    expect(screen.getByLabelText('Game status')).toBeInTheDocument();
    expect(screen.queryByText(/Level/)).toBeNull();
    expect(screen.queryByText(/Score/)).toBeNull();
    expect(screen.queryByText(/Campaign/)).toBeNull();
  });

  it('exposes a skip link to the campus', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: 'Skip to campus' })).toHaveAttribute('href', '#campus-main');
  });

  it('hosts global commands in the command bar', () => {
    renderLayout();
    const group = screen.getByRole('group', { name: 'Global commands' });
    expect(within(group).getByRole('button', { name: /Pause|Resume/ })).toBeInTheDocument();
  });
});

describe('LeftNavigation', () => {
  it('marks Campus current, Monitor read-only, Research disabled; selection is keyboard-accessible', async () => {
    render(<LeftNavigation />);
    const campus = screen.getByRole('button', { name: /Campus/ });
    const monitor = screen.getByRole('button', { name: /Monitor/ });
    const research = screen.getByRole('button', { name: /Research/ });
    expect(campus).toHaveAttribute('aria-current', 'page');
    expect(within(monitor).getByText('read-only')).toBeInTheDocument();
    expect(research).toHaveAttribute('aria-disabled', 'true');

    // Keyboard-select Build → becomes current, Campus no longer current.
    const build = screen.getByRole('button', { name: /Build/ });
    build.focus();
    await userEvent.keyboard('{Enter}');
    expect(build).toHaveAttribute('aria-current', 'page');
    expect(campus).not.toHaveAttribute('aria-current');
  });

  it('does not activate the disabled Research item', async () => {
    render(<LeftNavigation />);
    const research = screen.getByRole('button', { name: /Research/ });
    await userEvent.click(research);
    expect(research).not.toHaveAttribute('aria-current', 'page');
  });
});
