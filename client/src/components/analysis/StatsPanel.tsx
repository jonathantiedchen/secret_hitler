import { useMemo } from 'react';

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

interface StatsPanelProps {
  history: GameHistory;
}

interface PlayerStats {
  player: Player;
  timesPresident: number;
  timesChancellor: number;
  jaVotes: number;
  neinVotes: number;
  policiesEnacted: { liberal: number; fascist: number };
  votedWithWinners: number;
  totalVotes: number;
}

export function StatsPanel({ history }: StatsPanelProps) {
  const stats = useMemo(() => {
    const playerStats: Map<string, PlayerStats> = new Map();

    // Initialize stats for each player
    for (const player of history.players) {
      playerStats.set(player.id, {
        player,
        timesPresident: 0,
        timesChancellor: 0,
        jaVotes: 0,
        neinVotes: 0,
        policiesEnacted: { liberal: 0, fascist: 0 },
        votedWithWinners: 0,
        totalVotes: 0,
      });
    }

    // Track nominations and vote results for voting pattern analysis
    let currentVotes: Map<string, 'ja' | 'nein'> = new Map();

    for (const event of history.events) {
      const { type, data } = event;

      if (type === 'nomination') {
        const presidentId = data.presidentId as string;
        const presidentStats = playerStats.get(presidentId);
        if (presidentStats) {
          presidentStats.timesPresident++;
        }
        // Note: Chancellor count is updated when vote passes
      }

      if (type === 'vote') {
        const playerId = data.playerId as string;
        const vote = data.vote as 'ja' | 'nein';
        const stats = playerStats.get(playerId);
        if (stats) {
          if (vote === 'ja') stats.jaVotes++;
          else stats.neinVotes++;
          stats.totalVotes++;
        }
        currentVotes.set(playerId, vote);
      }

      if (type === 'vote_result') {
        // Calculate who voted with the majority
        const jaCount = data.jaCount as number;
        const neinCount = data.neinCount as number;
        const majorityVote = jaCount > neinCount ? 'ja' : 'nein';

        for (const [playerId, vote] of currentVotes) {
          if (vote === majorityVote) {
            const stats = playerStats.get(playerId);
            if (stats) stats.votedWithWinners++;
          }
        }

        // If passed, count chancellor
        if (data.passed) {
          const nomineeId = history.events
            .filter((e) => e.round === event.round && e.type === 'nomination')
            .pop()?.data.nomineeId as string;
          const chancellorStats = playerStats.get(nomineeId);
          if (chancellorStats) {
            chancellorStats.timesChancellor++;
          }
        }

        currentVotes = new Map();
      }

      if (type === 'chancellor_enact') {
        const playerId = data.playerId as string;
        const policy = data.enactedPolicy as 'liberal' | 'fascist';
        const stats = playerStats.get(playerId);
        if (stats) {
          stats.policiesEnacted[policy]++;
        }
      }
    }

    return Array.from(playerStats.values());
  }, [history]);

  // Calculate aggregate stats
  const aggregateStats = useMemo(() => {
    const totalRounds = Math.max(...history.events.map((e) => e.round));
    const voteEvents = history.events.filter((e) => e.type === 'vote_result');
    const passedVotes = voteEvents.filter((e) => e.data.passed).length;
    const failedVotes = voteEvents.length - passedVotes;

    const liberalPlayers = history.players.filter((p) => p.role === 'liberal').length;
    const fascistPlayers = history.players.filter((p) => p.role === 'fascist' || p.role === 'hitler').length;

    return {
      totalRounds,
      passedVotes,
      failedVotes,
      liberalPolicies: history.finalState.liberalPolicies,
      fascistPolicies: history.finalState.fascistPolicies,
      liberalPlayers,
      fascistPlayers,
    };
  }, [history]);

  const roleColors: Record<string, string> = {
    liberal: '#2563eb',
    fascist: '#dc2626',
    hitler: '#dc2626',
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
          <div className="text-neutral-500 text-xs uppercase tracking-wider mb-1 font-medium">Total Rounds</div>
          <div className="text-2xl font-bold text-neutral-900">{aggregateStats.totalRounds}</div>
        </div>
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
          <div className="text-neutral-500 text-xs uppercase tracking-wider mb-1 font-medium">Governments</div>
          <div className="text-2xl font-bold">
            <span className="text-green-600">{aggregateStats.passedVotes}</span>
            <span className="text-neutral-400 mx-1">/</span>
            <span className="text-red-600">{aggregateStats.failedVotes}</span>
          </div>
          <div className="text-xs text-neutral-400">passed / failed</div>
        </div>
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
          <div className="text-neutral-500 text-xs uppercase tracking-wider mb-1 font-medium">Liberal Policies</div>
          <div className="text-2xl font-bold text-blue-600">{aggregateStats.liberalPolicies}</div>
        </div>
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
          <div className="text-neutral-500 text-xs uppercase tracking-wider mb-1 font-medium">Fascist Policies</div>
          <div className="text-2xl font-bold text-red-600">{aggregateStats.fascistPolicies}</div>
        </div>
      </div>

      {/* Player Stats Table */}
      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 bg-neutral-50">
          <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">Player Statistics</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-neutral-400 uppercase tracking-wider border-b border-neutral-200">
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 text-center">President</th>
                <th className="px-4 py-3 text-center">Chancellor</th>
                <th className="px-4 py-3 text-center">JA Votes</th>
                <th className="px-4 py-3 text-center">NEIN Votes</th>
                <th className="px-4 py-3 text-center">Voting Accuracy</th>
                <th className="px-4 py-3 text-center">Policies Enacted</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((stat) => (
                <tr key={stat.player.id} className="border-b border-neutral-100 last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-neutral-900">{stat.player.name}</span>
                      <span className="text-xs text-neutral-400">{stat.player.model.split('/').pop()}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="px-2 py-0.5 text-xs rounded font-medium"
                      style={{
                        backgroundColor: stat.player.role === 'liberal' ? '#dbeafe' : '#fee2e2',
                        color: roleColors[stat.player.role],
                      }}
                    >
                      {stat.player.role.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-neutral-600">{stat.timesPresident}</td>
                  <td className="px-4 py-3 text-center text-neutral-600">{stat.timesChancellor}</td>
                  <td className="px-4 py-3 text-center text-green-600">{stat.jaVotes}</td>
                  <td className="px-4 py-3 text-center text-red-600">{stat.neinVotes}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-neutral-600">
                      {stat.totalVotes > 0
                        ? `${Math.round((stat.votedWithWinners / stat.totalVotes) * 100)}%`
                        : '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-blue-600">{stat.policiesEnacted.liberal}L</span>
                    <span className="text-neutral-400 mx-1">/</span>
                    <span className="text-red-600">{stat.policiesEnacted.fascist}F</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Voting Patterns */}
      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider mb-4">Team Composition</h3>
        <div className="flex gap-8">
          <div>
            <div className="text-xs text-neutral-500 mb-2">Liberals ({aggregateStats.liberalPlayers})</div>
            <div className="flex flex-wrap gap-2">
              {history.players
                .filter((p) => p.role === 'liberal')
                .map((p) => (
                  <span
                    key={p.id}
                    className="px-2 py-1 bg-blue-100 text-blue-700 text-sm rounded font-medium"
                  >
                    {p.name}
                  </span>
                ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 mb-2">Fascists ({aggregateStats.fascistPlayers})</div>
            <div className="flex flex-wrap gap-2">
              {history.players
                .filter((p) => p.role === 'fascist' || p.role === 'hitler')
                .map((p) => (
                  <span
                    key={p.id}
                    className="px-2 py-1 text-sm rounded font-medium"
                    style={{
                      backgroundColor: p.role === 'hitler' ? '#fecaca' : '#fee2e2',
                      color: '#dc2626',
                    }}
                  >
                    {p.name} {p.role === 'hitler' && '(Hitler)'}
                  </span>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
