import { useSetupStore } from '../../stores/setupStore';

// Default models when not fetched from OpenRouter
// Using verified OpenRouter model IDs
const defaultModels = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', provider: 'Anthropic' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { id: 'google/gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'Google' },
  { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'Google' },
  { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', provider: 'Meta' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'Meta' },
  { id: 'mistralai/mistral-small', name: 'Mistral Small', provider: 'Mistral' },
];

const presets = [
  { label: 'All GPT-4o Mini', model: 'openai/gpt-4o-mini' },
  { label: 'All Claude Haiku', model: 'anthropic/claude-3.5-haiku' },
  { label: 'Mixed Budget', models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku', 'google/gemini-1.5-flash'] },
  { label: 'Mixed Premium', models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-1.5-pro'] },
];

export function Step2Players() {
  const {
    players,
    availableModels,
    addPlayer,
    removePlayer,
    updatePlayer,
    setAllPlayerModels,
    nextStep,
    prevStep,
  } = useSetupStore();

  const models = availableModels.length > 0 ? availableModels : defaultModels;

  // Group models by provider
  const groupedModels = models.reduce((acc, model) => {
    const provider = model.provider || 'Other';
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(model);
    return acc;
  }, {} as Record<string, typeof models>);

  const handlePreset = (preset: typeof presets[0]) => {
    if ('model' in preset && preset.model) {
      setAllPlayerModels(preset.model);
    } else if ('models' in preset && preset.models) {
      // Cycle through models for variety
      players.forEach((player, index) => {
        const model = preset.models[index % preset.models.length];
        updatePlayer(player.id, { model });
      });
    }
  };

  const canContinue = players.length >= 5;

  return (
    <div className="max-w-xl mx-auto bg-neutral-50 border border-neutral-200 rounded-xl p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-medium text-neutral-900">Configure Players</h2>
          <p className="text-neutral-500 text-sm">Add 5-10 AI players to compete</p>
        </div>
        <span className="text-sm text-neutral-500">{players.length}/10 players</span>
      </div>

      {/* Quick Fill Buttons */}
      <div className="flex flex-wrap gap-2 mb-5">
        {presets.map((preset) => (
          <button
            key={preset.label}
            onClick={() => handlePreset(preset)}
            className="px-3 py-2 border border-neutral-200 rounded-md bg-white text-xs hover:bg-neutral-50 hover:border-neutral-300 transition-colors"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Player List */}
      <div className="flex flex-col gap-3 mb-5 max-h-80 overflow-y-auto">
        {players.map((player, index) => (
          <div
            key={player.id}
            className="flex gap-3 items-center bg-white border border-neutral-200 rounded-lg p-3"
          >
            {/* Number badge */}
            <div className="w-8 h-8 bg-neutral-100 rounded-full flex items-center justify-center font-medium text-neutral-500 text-sm shrink-0">
              {index + 1}
            </div>

            {/* Name input */}
            <input
              type="text"
              value={player.name}
              onChange={(e) => updatePlayer(player.id, { name: e.target.value })}
              className="flex-1 min-w-0 px-3 py-2 border border-neutral-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
            />

            {/* Model dropdown */}
            <select
              value={player.model}
              onChange={(e) => updatePlayer(player.id, { model: e.target.value })}
              className="flex-1 min-w-0 px-3 py-2 border border-neutral-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
            >
              {Object.entries(groupedModels).map(([provider, providerModels]) => (
                <optgroup key={provider} label={provider}>
                  {providerModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {/* Remove button */}
            {players.length > 5 && (
              <button
                onClick={() => removePlayer(player.id)}
                className="p-2 text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add Player Button */}
      {players.length < 10 && (
        <button
          onClick={addPlayer}
          className="w-full py-3 border border-dashed border-neutral-300 rounded-lg bg-white text-neutral-500 text-sm hover:bg-neutral-50 hover:border-neutral-400 transition-colors mb-6"
        >
          + Add Player
        </button>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={prevStep}
          className="px-6 py-3.5 bg-white border border-neutral-200 rounded-lg text-sm hover:bg-neutral-50 transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={nextStep}
          disabled={!canContinue}
          className={`
            px-6 py-3.5 bg-neutral-900 text-white rounded-lg text-sm font-medium
            transition-colors
            ${canContinue ? 'hover:bg-neutral-800' : 'opacity-50 cursor-not-allowed'}
          `}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
