import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReplayTimeline } from '../components/analysis/ReplayTimeline';
import { StatsPanel } from '../components/analysis/StatsPanel';
import { ReasoningLog } from '../components/analysis/ReasoningLog';
import { SERVER_URL } from '../config';

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
  isAlive: boolean;
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

type Tab = 'replay' | 'stats' | 'reasoning';

export function AnalysisPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [history, setHistory] = useState<GameHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('replay');

  useEffect(() => {
    if (!gameId) return;

    fetch(`${SERVER_URL}/api/games/${gameId}/history`)
      .then((res) => {
        if (!res.ok) throw new Error('Game not found');
        return res.json();
      })
      .then((data) => {
        setHistory(data.history);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [gameId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-neutral-500 text-lg">Loading game history...</div>
      </div>
    );
  }

  if (error || !history) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <div className="text-red-500 text-lg">{error || 'Game not found'}</div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 border border-neutral-300 hover:bg-neutral-50 text-neutral-700 rounded-lg"
        >
          Back to Home
        </button>
      </div>
    );
  }

  const isLiberalWin = history.finalState.winner === 'liberal';
  const gameDuration = history.endTime
    ? Math.round((history.endTime - history.startTime) / 1000)
    : 0;

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'replay', label: 'Game Replay', icon: '▶️' },
    { id: 'stats', label: 'Statistics', icon: '📊' },
    { id: 'reasoning', label: 'AI Reasoning', icon: '🧠' },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-neutral-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 mb-1">Game Analysis</h1>
            <div className="flex items-center gap-4 text-sm text-neutral-500">
              <span
                className="font-medium"
                style={{ color: isLiberalWin ? '#2563eb' : '#dc2626' }}
              >
                {isLiberalWin ? 'Liberals Won' : 'Fascists Won'}
              </span>
              <span>•</span>
              <span>{history.finalState.winCondition}</span>
              <span>•</span>
              <span>{history.players.length} players</span>
              <span>•</span>
              <span>{Math.floor(gameDuration / 60)}m {gameDuration % 60}s</span>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg transition-colors"
          >
            New Game
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-neutral-900'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-neutral-900" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {activeTab === 'replay' && (
          <ReplayTimeline history={history} />
        )}
        {activeTab === 'stats' && (
          <StatsPanel history={history} />
        )}
        {activeTab === 'reasoning' && (
          <ReasoningLog history={history} />
        )}
      </div>
    </div>
  );
}
