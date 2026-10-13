import { useSetupStore } from '../../stores/setupStore';

// Role distribution based on player count
function getRoleDistribution(playerCount: number) {
  if (playerCount <= 6) return { liberals: playerCount - 2, fascists: 1, hitler: 1 };
  if (playerCount <= 8) return { liberals: playerCount - 3, fascists: 2, hitler: 1 };
  return { liberals: playerCount - 4, fascists: 3, hitler: 1 };
}

// Get short model name from full ID
function getShortModelName(modelId: string) {
  const parts = modelId.split('/');
  const name = parts[parts.length - 1];
  return name.replace(/-instruct|-it/g, '').replace('llama-3.1-', 'llama-').replace('claude-', 'claude-');
}

interface Step4StartProps {
  onStart: () => void;
  onEditStep: (step: number) => void;
}

export function Step4Start({ onStart, onEditStep }: Step4StartProps) {
  const {
    apiKey,
    isMockMode,
    players,
    settings,
    prevStep,
  } = useSetupStore();

  const roles = getRoleDistribution(players.length);
  const displayPlayers = players.slice(0, 4);
  const remainingCount = players.length - 4;

  // Mask API key for display
  const maskedKey = apiKey
    ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
    : '';

  // Format settings summary
  const settingsSummary = [
    settings.speedMode === 'realtime' ? `Realtime (${settings.actionDelay}s delay)` : 'Fast mode',
    settings.showThoughts ? 'Thoughts visible' : 'Thoughts hidden',
    settings.revealRoles ? 'Roles visible to you' : 'Roles hidden',
    `Lying ${{ none: 'not mentioned', allowed: 'allowed', encouraged: 'encouraged', forbidden: 'forbidden' }[settings.lyingInstruction ?? 'allowed']}`,
  ].join(' • ');

  return (
    <div className="max-w-xl mx-auto bg-neutral-50 border border-neutral-200 rounded-xl p-8">
      <div className="text-center mb-6">
        <h2 className="text-lg font-medium text-neutral-900">Ready to Play!</h2>
        <p className="text-neutral-500 text-sm">Review your configuration below</p>
      </div>

      {/* Summary Cards */}
      <div className="flex flex-col gap-4 mb-6">
        {/* API Status */}
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium text-neutral-900">
                  {isMockMode ? 'Mock Mode' : 'OpenRouter Connected'}
                </div>
                <div className="text-xs text-neutral-500">
                  {isMockMode ? 'Using simulated responses' : maskedKey}
                </div>
              </div>
            </div>
            <button
              onClick={() => onEditStep(1)}
              className="px-3 py-1.5 text-xs border border-neutral-200 rounded-md bg-white hover:bg-neutral-50 transition-colors"
            >
              Edit
            </button>
          </div>
        </div>

        {/* Players Summary */}
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          <div className="flex justify-between items-start mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-neutral-100 rounded-lg flex items-center justify-center">
                <span className="text-lg">👥</span>
              </div>
              <div>
                <div className="text-sm font-medium text-neutral-900">
                  {players.length} Players
                </div>
                <div className="text-xs text-neutral-500">
                  {roles.liberals} Liberals, {roles.fascists} Fascists, 1 Hitler
                </div>
              </div>
            </div>
            <button
              onClick={() => onEditStep(2)}
              className="px-3 py-1.5 text-xs border border-neutral-200 rounded-md bg-white hover:bg-neutral-50 transition-colors"
            >
              Edit
            </button>
          </div>

          {/* Player Pills */}
          <div className="flex flex-wrap gap-2 mt-3">
            {displayPlayers.map((player) => (
              <div
                key={player.id}
                className="flex items-center gap-1.5 bg-neutral-100 px-2.5 py-1.5 rounded-full text-xs"
              >
                <span className="font-medium">{player.name.replace('Agent ', '')}</span>
                <span className="text-neutral-500">{getShortModelName(player.model)}</span>
              </div>
            ))}
            {remainingCount > 0 && (
              <div className="flex items-center bg-neutral-100 px-2.5 py-1.5 rounded-full text-xs text-neutral-500">
                +{remainingCount} more
              </div>
            )}
          </div>
        </div>

        {/* Settings Summary */}
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-neutral-100 rounded-lg flex items-center justify-center">
                <span className="text-lg">⚙️</span>
              </div>
              <div>
                <div className="text-sm font-medium text-neutral-900">Game Settings</div>
                <div className="text-xs text-neutral-500 mt-1">{settingsSummary}</div>
              </div>
            </div>
            <button
              onClick={() => onEditStep(3)}
              className="px-3 py-1.5 text-xs border border-neutral-200 rounded-md bg-white hover:bg-neutral-50 transition-colors"
            >
              Edit
            </button>
          </div>
        </div>
      </div>

      {/* Cost Estimate */}
      {!isMockMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">💰</span>
            <span className="text-sm font-medium text-amber-900">Estimated Cost</span>
          </div>
          <p className="text-sm text-amber-800">
            ~$0.02 - $0.15 per game depending on model mix and game length
          </p>
        </div>
      )}

      {isMockMode && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">🤖</span>
            <span className="text-sm font-medium text-blue-900">Mock Mode Active</span>
          </div>
          <p className="text-sm text-blue-800">
            No API costs - using simulated AI responses
          </p>
        </div>
      )}

      {/* Start Button */}
      <button
        onClick={onStart}
        className="w-full py-4 bg-neutral-900 text-white rounded-lg text-base font-semibold hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2"
      >
        🎭 Start Game
      </button>

      {/* Back Link */}
      <div className="text-center mt-4">
        <button
          onClick={prevStep}
          className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
        >
          ← Back to Settings
        </button>
      </div>
    </div>
  );
}
