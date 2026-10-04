import { Tooltip } from './Tooltip';

interface PolicyTracksProps {
  liberalPolicies: number;
  fascistPolicies: number;
  failedElections: number;
}

export function PolicyTracks({ liberalPolicies, fascistPolicies, failedElections }: PolicyTracksProps) {
  return (
    <div className="flex justify-center gap-12 py-5 border-b border-neutral-200">
      {/* Liberal Track */}
      <Tooltip
        content="Liberals win by enacting 5 Liberal policies or killing Hitler"
        position="bottom"
      >
        <div className="text-center cursor-help">
          <div className="text-blue-600 text-[10px] uppercase tracking-wider mb-2 font-medium">
            Liberal {liberalPolicies}/5
          </div>
          <div className="flex gap-1.5">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className={`w-7 h-9 rounded ${
                  i < liberalPolicies ? 'bg-blue-500' : 'bg-blue-100'
                }`}
              />
            ))}
          </div>
        </div>
      </Tooltip>

      {/* Election Tracker */}
      <Tooltip
        content="After 3 failed elections, the top policy from the deck is enacted automatically and the election tracker resets"
        position="bottom"
      >
        <div className="text-center cursor-help">
          <div className="text-neutral-500 text-[10px] uppercase tracking-wider mb-2 font-medium">
            Failed
          </div>
          <div className="flex gap-1 items-center pt-2.5">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className={`w-2.5 h-2.5 rounded-full ${
                  i < failedElections ? 'bg-red-500' : 'bg-neutral-200'
                }`}
              />
            ))}
          </div>
        </div>
      </Tooltip>

      {/* Fascist Track */}
      <Tooltip
        content="Fascists win by enacting 6 Fascist policies or electing Hitler as Chancellor after 3+ Fascist policies"
        position="bottom"
      >
        <div className="text-center cursor-help">
          <div className="text-red-600 text-[10px] uppercase tracking-wider mb-2 font-medium">
            Fascist {fascistPolicies}/6
          </div>
          <div className="flex gap-1.5">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className={`w-7 h-9 rounded ${
                  i < fascistPolicies ? 'bg-red-600' : 'bg-red-100'
                }`}
              />
            ))}
          </div>
        </div>
      </Tooltip>
    </div>
  );
}
