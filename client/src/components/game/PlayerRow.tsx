import type { GamePlayer } from '../../stores/gameStore';
import { PlayerAvatar } from './PlayerAvatar';

interface PlayerRowProps {
  players: GamePlayer[];
  presidentIndex: number;
  chancellorIndex: number | null;
  nomineeIndex?: number | null;
  showVotes: boolean;
  selectedPlayerIndex: number | null;
  onPlayerClick: (index: number) => void;
}

export function PlayerRow({
  players,
  presidentIndex,
  chancellorIndex,
  nomineeIndex = null,
  showVotes,
  selectedPlayerIndex,
  onPlayerClick,
}: PlayerRowProps) {
  return (
    <div className="py-8 px-6">
      <div className="flex justify-center gap-6">
        {players.map((player, index) => (
          <PlayerAvatar
            key={player.id}
            name={player.name}
            icon={player.modelIcon}
            color={player.modelColor}
            role={player.role}
            isAlive={player.isAlive}
            isPresident={index === presidentIndex}
            isChancellor={index === chancellorIndex}
            isNominee={index === nomineeIndex}
            vote={player.currentVote}
            showVotes={showVotes}
            isSelected={index === selectedPlayerIndex}
            onClick={() => onPlayerClick(index)}
          />
        ))}
      </div>
    </div>
  );
}
