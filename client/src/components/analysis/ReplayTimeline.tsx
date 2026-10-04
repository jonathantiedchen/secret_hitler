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

interface ReplayTimelineProps {
  history: GameHistory;
}

// Group events by round
interface RoundGroup {
  round: number;
  events: GameEvent[];
}

const eventTypeLabels: Record<string, string> = {
  game_start: 'Game Started',
  nomination: 'Nomination',
  vote: 'Vote Cast',
  vote_result: 'Vote Result',
  cards_drawn: 'Cards Drawn',
  president_discard: 'President Discarded',
  chancellor_enact: 'Chancellor Enacted',
  policy_enacted: 'Policy Enacted',
  execution: 'Execution',
  investigation: 'Investigation',
  special_election: 'Special Election',
  game_over: 'Game Over',
  dialogue: 'Dialogue',
  thought: 'Thought',
};

const eventTypeColors: Record<string, string> = {
  game_start: '#737373',
  nomination: '#d97706',
  vote: '#737373',
  vote_result: '#16a34a',
  cards_drawn: '#737373',
  president_discard: '#ea580c',
  chancellor_enact: '#ea580c',
  policy_enacted: '#2563eb',
  execution: '#dc2626',
  investigation: '#7c3aed',
  special_election: '#d97706',
  game_over: '#171717',
  dialogue: '#737373',
  thought: '#a3a3a3',
};

export function ReplayTimeline({ history }: ReplayTimelineProps) {
  const [expandedRound, setExpandedRound] = useState<number | null>(1);
  const [showThoughts, setShowThoughts] = useState(true);
  const [showDialogue, setShowDialogue] = useState(true);

  // Group events by round
  const roundGroups = useMemo(() => {
    const groups: RoundGroup[] = [];
    let currentRound = 0;
    let currentEvents: GameEvent[] = [];

    for (const event of history.events) {
      if (event.round !== currentRound) {
        if (currentEvents.length > 0) {
          groups.push({ round: currentRound, events: currentEvents });
        }
        currentRound = event.round;
        currentEvents = [];
      }
      currentEvents.push(event);
    }
    if (currentEvents.length > 0) {
      groups.push({ round: currentRound, events: currentEvents });
    }

    return groups;
  }, [history.events]);

  // Filter events based on toggle settings
  const filterEvents = (events: GameEvent[]) => {
    return events.filter((e) => {
      if (e.type === 'thought' && !showThoughts) return false;
      if (e.type === 'dialogue' && !showDialogue) return false;
      if (e.type === 'thinking') return false; // Always hide thinking events
      return true;
    });
  };

  const formatEventContent = (event: GameEvent) => {
    const { type, data } = event;

    switch (type) {
      case 'game_start':
        return `Game started with ${(data.players as Array<unknown>)?.length || 0} players`;
      case 'nomination':
        return `${data.presidentName} nominated ${data.nomineeName} as Chancellor`;
      case 'vote':
        return `${data.playerName} voted ${(data.vote as string)?.toUpperCase()}`;
      case 'vote_result':
        return data.passed
          ? `Vote passed ${data.jaCount}-${data.neinCount}`
          : `Vote failed ${data.jaCount}-${data.neinCount}`;
      case 'cards_drawn':
        return `President drew: ${(data.cards as string[])?.join(', ')}`;
      case 'president_discard':
        return `President discarded ${data.discardedCard}, passed ${(data.passedCards as string[])?.join(', ')}`;
      case 'chancellor_enact':
        return `Chancellor enacted ${data.enactedPolicy} policy`;
      case 'policy_enacted':
        return `${(data.policy as string)?.charAt(0).toUpperCase()}${(data.policy as string)?.slice(1)} policy enacted (L:${data.liberalPolicies} F:${data.fascistPolicies})`;
      case 'execution':
        return `${data.targetName} was executed (${data.targetRole})`;
      case 'investigation':
        return `President investigated ${data.targetName}: ${data.revealedParty}`;
      case 'special_election':
        return `${data.targetName} was chosen as next President`;
      case 'dialogue':
        return `${data.playerName}: "${data.content}"`;
      case 'thought':
        return `${data.playerName} thinks: "${data.content}"`;
      case 'game_over':
        return `${data.winner === 'liberal' ? 'Liberals' : 'Fascists'} win: ${data.winCondition}`;
      default:
        return type;
    }
  };

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showThoughts}
            onChange={(e) => setShowThoughts(e.target.checked)}
            className="rounded border-neutral-300 bg-white text-blue-600"
          />
          Show AI Thoughts
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showDialogue}
            onChange={(e) => setShowDialogue(e.target.checked)}
            className="rounded border-neutral-300 bg-white text-blue-600"
          />
          Show Dialogue
        </label>
      </div>

      {/* Timeline */}
      <div className="space-y-4">
        {roundGroups.map((group) => (
          <div key={group.round} className="bg-neutral-50 border border-neutral-200 rounded-lg overflow-hidden">
            {/* Round Header */}
            <button
              onClick={() => setExpandedRound(expandedRound === group.round ? null : group.round)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-neutral-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-neutral-500 text-sm">Round {group.round}</span>
                <span className="text-neutral-900 font-medium">
                  {group.events.find((e) => e.type === 'nomination')
                    ? `${(group.events.find((e) => e.type === 'nomination')?.data.presidentName)} → ${(group.events.find((e) => e.type === 'nomination')?.data.nomineeName)}`
                    : 'Game Start'}
                </span>
                {group.events.find((e) => e.type === 'policy_enacted') && (
                  <span
                    className="px-2 py-0.5 text-xs rounded font-medium"
                    style={{
                      backgroundColor:
                        (group.events.find((e) => e.type === 'policy_enacted')?.data.policy) === 'liberal'
                          ? '#dbeafe'
                          : '#fee2e2',
                      color:
                        (group.events.find((e) => e.type === 'policy_enacted')?.data.policy) === 'liberal'
                          ? '#2563eb'
                          : '#dc2626',
                    }}
                  >
                    {(group.events.find((e) => e.type === 'policy_enacted')?.data.policy as string)?.toUpperCase()}
                  </span>
                )}
                {group.events.find((e) => e.type === 'vote_result' && !e.data.passed) && (
                  <span className="px-2 py-0.5 text-xs rounded bg-red-100 text-red-600 font-medium">
                    FAILED
                  </span>
                )}
              </div>
              <span className="text-neutral-400">{expandedRound === group.round ? '▼' : '▶'}</span>
            </button>

            {/* Expanded Events */}
            {expandedRound === group.round && (
              <div className="border-t border-neutral-200 px-4 py-3 space-y-2 bg-white">
                {filterEvents(group.events).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 text-sm py-1"
                  >
                    <div
                      className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                      style={{ backgroundColor: eventTypeColors[event.type] || '#737373' }}
                    />
                    <div className="flex-1">
                      <span className="text-neutral-400 mr-2">
                        {eventTypeLabels[event.type] || event.type}
                      </span>
                      <span
                        className={
                          event.type === 'thought'
                            ? 'text-neutral-500 italic'
                            : event.type === 'dialogue'
                            ? 'text-neutral-600'
                            : 'text-neutral-900'
                        }
                      >
                        {formatEventContent(event)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
