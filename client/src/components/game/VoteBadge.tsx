import type { Vote } from '../../stores/gameStore';

interface VoteBadgeProps {
  vote: Vote;
  canVote: boolean;
}

export function VoteBadge({ vote, canVote }: VoteBadgeProps) {
  if (!canVote) {
    return <div className="text-neutral-300 text-[10px] py-0.5 px-2 mt-1.5">—</div>;
  }

  if (vote === null) {
    return null;
  }

  const isJa = vote === 'ja';

  return (
    <div
      className={`text-[10px] font-semibold py-0.5 px-2 rounded mt-1.5 ${
        isJa ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
      }`}
    >
      {isJa ? 'JA' : 'NEIN'}
    </div>
  );
}
