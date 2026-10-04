import type { LegislationState } from '../../stores/gameStore';
import { Tooltip } from './Tooltip';

interface LegislationViewProps {
  legislation: LegislationState;
  presidentName: string;
  chancellorName: string;
  isChancellorPhase: boolean;
}

export function LegislationView({
  legislation,
  presidentName,
  chancellorName,
  isChancellorPhase,
}: LegislationViewProps) {
  const { presidentCards, discardedCard, chancellorCards } = legislation;

  return (
    <div className="text-center py-5 border-t border-b border-neutral-200 bg-neutral-50">
      <div className="text-amber-600 text-[13px] uppercase tracking-[2px] mb-4 font-medium">
        Legislation
      </div>

      {/* Spectator View Label */}
      <Tooltip
        content="In a real game, only the President knows all 3 cards drawn, and only President + Chancellor know the 2 cards passed"
        position="bottom"
      >
        <div className="inline-block bg-amber-50 border border-amber-200 py-1 px-3 rounded mb-4 cursor-help">
          <span className="text-amber-700 text-[10px]">
            👁 Spectator view — hidden from other players
          </span>
        </div>
      </Tooltip>

      {/* Cards Visualization */}
      <div className="flex justify-center items-center gap-8">
        {/* President's Hand */}
        <div className="text-center">
          <div className="text-neutral-500 text-[11px] mb-2">
            {presidentName} drew 3
          </div>
          <div className="flex gap-1.5">
            {presidentCards.map((card, i) => {
              const isDiscarded = discardedCard && i === presidentCards.indexOf(discardedCard);
              return (
                <div
                  key={i}
                  className={`w-9 h-12 rounded ${
                    card === 'liberal' ? 'bg-blue-500' : 'bg-red-600'
                  } ${isDiscarded ? 'opacity-40 line-through' : ''}`}
                />
              );
            })}
          </div>
          {discardedCard && (
            <div className="text-neutral-400 text-[10px] mt-1.5">
              Discarded 1 {discardedCard === 'liberal' ? '🔵' : '🔴'}
            </div>
          )}
        </div>

        {/* Arrow */}
        <div className="text-neutral-300 text-xl">→</div>

        {/* Chancellor's Hand */}
        <div className="text-center">
          <div className="text-neutral-500 text-[11px] mb-2">
            {chancellorName} received 2
          </div>
          <div className="flex gap-1.5">
            {chancellorCards.map((card, i) => (
              <div
                key={i}
                className={`w-9 h-12 rounded ${
                  card === 'liberal' ? 'bg-blue-500' : 'bg-red-600'
                }`}
              />
            ))}
          </div>
          <div className="text-neutral-400 text-[10px] mt-1.5">
            {isChancellorPhase ? 'Choosing...' : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
