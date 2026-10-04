import type { GamePhase } from '../../stores/gameStore';

interface PhaseStripProps {
  phase: GamePhase;
  description: string;
  voteResult?: {
    passed: boolean;
    jaCount: number;
    neinCount: number;
  };
}

const phaseLabels: Record<GamePhase, string> = {
  nomination: 'Nomination',
  voting: 'Voting',
  legislation_president: 'Legislation',
  legislation_chancellor: 'Legislation',
  policy_enacted: 'Policy Enacted',
  executive_action: 'Executive Action',
  game_over: 'Game Over',
};

const phaseColors: Record<GamePhase, string> = {
  nomination: '#d97706',
  voting: '#d97706',
  legislation_president: '#d97706',
  legislation_chancellor: '#d97706',
  policy_enacted: '#16a34a',
  executive_action: '#dc2626',
  game_over: '#171717',
};

export function PhaseStrip({ phase, description, voteResult }: PhaseStripProps) {
  const label = phaseLabels[phase];
  const color = phaseColors[phase];

  return (
    <div className="text-center py-6 border-t border-b border-neutral-200 bg-neutral-50">
      <div
        className="text-[13px] uppercase tracking-[2px] mb-2 font-medium"
        style={{ color }}
      >
        {label}
      </div>
      <div className="text-neutral-900 text-[15px]">{description}</div>
      {voteResult && (
        <div className="text-neutral-500 text-xs mt-1">
          {voteResult.jaCount} JA · {voteResult.neinCount} NEIN
        </div>
      )}
    </div>
  );
}
