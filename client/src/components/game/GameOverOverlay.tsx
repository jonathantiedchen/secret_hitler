import { useNavigate } from 'react-router-dom';
import type { GamePlayer, Role } from '../../stores/gameStore';
import { useGameStore } from '../../stores/gameStore';

interface GameOverOverlayProps {
  winner: 'liberal' | 'fascist';
  winCondition: string;
  players: GamePlayer[];
}

const roleLabels: Record<Role, string> = {
  liberal: 'Liberal',
  fascist: 'Fascist',
  hitler: 'Hitler',
};

const roleColors: Record<Role, string> = {
  liberal: '#3b82f6',
  fascist: '#dc2626',
  hitler: '#dc2626',
};

export function GameOverOverlay({ winner, winCondition, players }: GameOverOverlayProps) {
  const navigate = useNavigate();
  const gameId = useGameStore((state) => state.gameId);
  const isLiberalWin = winner === 'liberal';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white border border-neutral-200 rounded-2xl p-8 max-w-lg w-full mx-4 text-center shadow-xl">
        {/* Winner Announcement */}
        <div
          className="text-4xl font-bold mb-2"
          style={{ color: isLiberalWin ? '#2563eb' : '#dc2626' }}
        >
          {isLiberalWin ? 'Liberals Win!' : 'Fascists Win!'}
        </div>

        {/* Win Condition */}
        <div className="text-neutral-500 text-lg mb-8">{winCondition}</div>

        {/* Role Reveal */}
        <div className="mb-8">
          <div className="text-neutral-400 text-sm uppercase tracking-wider mb-4 font-medium">
            Role Reveal
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {players.map((player) => (
              <div key={player.id} className="text-center w-20">
                <div
                  className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center text-2xl mb-1"
                  style={{ backgroundColor: player.modelColor }}
                >
                  {player.modelIcon}
                </div>
                <div className="text-neutral-900 text-xs">{player.name}</div>
                <div
                  className="text-[10px] font-medium"
                  style={{ color: roleColors[player.role] }}
                >
                  {roleLabels[player.role]}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-4 justify-center">
          <button
            className="px-6 py-2.5 border border-neutral-300 hover:bg-neutral-50 text-neutral-700 rounded-lg transition-colors"
            onClick={() => navigate('/')}
          >
            New Game
          </button>
          <button
            className="px-6 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg transition-colors"
            onClick={() => navigate(`/analysis/${gameId}`)}
          >
            View Analysis
          </button>
        </div>
      </div>
    </div>
  );
}
