import { useState, useMemo } from 'react';

interface GameEvent {
  id: string;
  type: string;
  timestamp: number;
  round: number;
  phase: string;
  data: Record<string, unknown>;
}

interface Player {
  id: string;
  name: string;
  model: string;
  role: 'liberal' | 'fascist' | 'hitler';
}

interface GameHistory {
  gameId: string;
  startTime: number;
  endTime: number | null;
  players: Player[];
  events: GameEvent[];
  finalState: {
    winner: 'liberal' | 'fascist' | null;
    winCondition: string | null;
    liberalPolicies: number;
    fascistPolicies: number;
  };
}

interface ReasoningLogProps {
  history: GameHistory;
}

interface ThoughtEntry {
  round: number;
  phase: string;
  playerId: string;
  playerName: string;
  thought: string;
  dialogue?: string;
  action?: string;
  timestamp: number;
}

export function ReasoningLog({ history }: ReasoningLogProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  // Group thoughts by player and round
  const thoughtEntries = useMemo(() => {
    const entries: ThoughtEntry[] = [];
    let currentThought: Partial<ThoughtEntry> | null = null;

    for (const event of history.events) {
      if (event.type === 'thought') {
        // If we have a pending thought from the same player, save it first
        if (currentThought && currentThought.playerId !== event.data.playerId) {
          entries.push(currentThought as ThoughtEntry);
        }

        currentThought = {
          round: event.round,
          phase: event.phase,
          playerId: event.data.playerId as string,
          playerName: event.data.playerName as string,
          thought: event.data.content as string,
          timestamp: event.timestamp,
        };
      } else if (event.type === 'dialogue' && currentThought && currentThought.playerId === event.data.playerId) {
        currentThought.dialogue = event.data.content as string;
      } else if (
        ['nomination', 'vote', 'president_discard', 'chancellor_enact', 'execution', 'investigation', 'special_election'].includes(event.type) &&
        currentThought
      ) {
        // Determine action description
        let action = '';
        switch (event.type) {
          case 'nomination':
            action = `Nominated ${event.data.nomineeName}`;
            break;
          case 'vote':
            action = `Voted ${(event.data.vote as string).toUpperCase()}`;
            break;
          case 'president_discard':
            action = `Discarded ${event.data.discardedCard}`;
            break;
          case 'chancellor_enact':
            action = `Enacted ${event.data.enactedPolicy}`;
            break;
          case 'execution':
            action = `Executed ${event.data.targetName}`;
            break;
          case 'investigation':
            action = `Investigated ${event.data.targetName}`;
            break;
          case 'special_election':
            action = `Chose ${event.data.targetName} as next President`;
            break;
        }

        if (currentThought.playerId === event.data.playerId || currentThought.playerId === event.data.presidentId) {
          currentThought.action = action;
          entries.push(currentThought as ThoughtEntry);
          currentThought = null;
        }
      }
    }

    // Add any remaining thought
    if (currentThought && currentThought.thought) {
      entries.push(currentThought as ThoughtEntry);
    }

    return entries;
  }, [history.events]);

  // Get unique rounds
  const rounds = useMemo(() => {
    const roundSet = new Set(thoughtEntries.map((e) => e.round));
    return Array.from(roundSet).sort((a, b) => a - b);
  }, [thoughtEntries]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return thoughtEntries.filter((entry) => {
      if (selectedPlayer && entry.playerId !== selectedPlayer) return false;
      if (selectedRound !== null && entry.round !== selectedRound) return false;
      return true;
    });
  }, [thoughtEntries, selectedPlayer, selectedRound]);

  const getPlayerRole = (playerId: string) => {
    return history.players.find((p) => p.id === playerId)?.role || 'liberal';
  };

  const roleColors: Record<string, string> = {
    liberal: '#2563eb',
    fascist: '#dc2626',
    hitler: '#dc2626',
  };

  const phaseLabels: Record<string, string> = {
    nomination: 'Nomination',
    voting: 'Voting',
    legislation_president: 'President Legislation',
    legislation_chancellor: 'Chancellor Legislation',
    veto_proposed: 'Veto Response',
    executive_action: 'Executive Action',
  };

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div>
          <label className="block text-xs text-neutral-500 uppercase tracking-wider mb-1 font-medium">Player</label>
          <select
            value={selectedPlayer || ''}
            onChange={(e) => setSelectedPlayer(e.target.value || null)}
            className="bg-white border border-neutral-300 rounded px-3 py-1.5 text-sm text-neutral-900"
          >
            <option value="">All Players</option>
            {history.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name} ({player.role})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-neutral-500 uppercase tracking-wider mb-1 font-medium">Round</label>
          <select
            value={selectedRound ?? ''}
            onChange={(e) => setSelectedRound(e.target.value ? Number(e.target.value) : null)}
            className="bg-white border border-neutral-300 rounded px-3 py-1.5 text-sm text-neutral-900"
          >
            <option value="">All Rounds</option>
            {rounds.map((round) => (
              <option key={round} value={round}>
                Round {round}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={() => {
              setSelectedPlayer(null);
              setSelectedRound(null);
            }}
            className="px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Entries */}
      <div className="space-y-4">
        {filteredEntries.length === 0 ? (
          <div className="text-center text-neutral-400 py-8">No thoughts recorded for this selection</div>
        ) : (
          filteredEntries.map((entry, index) => {
            const role = getPlayerRole(entry.playerId);
            return (
              <div
                key={`${entry.playerId}-${entry.round}-${index}`}
                className="bg-white border border-neutral-200 rounded-lg overflow-hidden"
              >
                {/* Header */}
                <div className="px-4 py-2 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-neutral-900">{entry.playerName}</span>
                    <span
                      className="px-2 py-0.5 text-xs rounded font-medium"
                      style={{
                        backgroundColor: role === 'liberal' ? '#dbeafe' : '#fee2e2',
                        color: roleColors[role],
                      }}
                    >
                      {role.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-neutral-400">
                    <span>Round {entry.round}</span>
                    <span>•</span>
                    <span>{phaseLabels[entry.phase] || entry.phase}</span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4 space-y-3">
                  {/* Thought */}
                  <div>
                    <div className="text-xs text-neutral-400 uppercase tracking-wider mb-1 font-medium">Internal Thought</div>
                    <div className="text-neutral-600 italic leading-relaxed">"{entry.thought}"</div>
                  </div>

                  {/* Dialogue */}
                  {entry.dialogue && (
                    <div>
                      <div className="text-xs text-neutral-400 uppercase tracking-wider mb-1 font-medium">Public Statement</div>
                      <div className="text-neutral-900 leading-relaxed">"{entry.dialogue}"</div>
                    </div>
                  )}

                  {/* Action */}
                  {entry.action && (
                    <div>
                      <div className="text-xs text-neutral-400 uppercase tracking-wider mb-1 font-medium">Action Taken</div>
                      <div className="text-amber-600 font-medium">{entry.action}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
