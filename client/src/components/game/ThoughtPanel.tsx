import type { GamePlayer, Role } from '../../stores/gameStore';
import { Tooltip } from './Tooltip';

interface ThoughtPanelProps {
  player: GamePlayer;
  isPinned: boolean;
}

const roleColors: Record<Role, string> = {
  liberal: '#3b82f6',
  fascist: '#ef4444',
  hitler: '#ef4444',
};

const roleLabels: Record<Role, string> = {
  liberal: 'Liberal',
  fascist: 'Fascist',
  hitler: 'Hitler',
};

const roleTooltips: Record<Role, string> = {
  liberal: 'Liberals win by enacting 5 Liberal policies or killing Hitler. They don\'t know anyone\'s role.',
  fascist: 'Fascists know each other and Hitler. They win by enacting 6 Fascist policies or electing Hitler after 3+ Fascist policies.',
  hitler: 'Hitler doesn\'t know who the Fascists are (in 7+ player games). Fascists try to get Hitler elected.',
};

export function ThoughtPanel({ player, isPinned }: ThoughtPanelProps) {
  return (
    <div className="p-5">
      {/* Player Header */}
      <div className="flex items-center gap-2.5 mb-3">
        <Tooltip content="Spectator view - only you can see this player's private thoughts" position="right">
          <span className="text-neutral-400 text-[11px] cursor-help">👁</span>
        </Tooltip>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
          style={{ backgroundColor: player.modelColor }}
        >
          {player.modelIcon}
        </div>
        <div className="text-neutral-900 text-[13px] font-medium">{player.name}</div>
        <Tooltip content={roleTooltips[player.role]} position="bottom">
          <div
            className="text-[11px] cursor-help font-medium"
            style={{ color: roleColors[player.role] }}
          >
            {roleLabels[player.role]}
          </div>
        </Tooltip>
        {isPinned && (
          <Tooltip content="Click another player to switch, or click the same player to unpin" position="left">
            <div className="text-neutral-400 text-[10px] ml-auto cursor-help">pinned</div>
          </Tooltip>
        )}
      </div>

      {/* Thought Content */}
      <div className="text-neutral-600 text-[13px] leading-relaxed">
        {player.currentThought || (
          <span className="text-neutral-400 italic">Thinking...</span>
        )}
      </div>
    </div>
  );
}
