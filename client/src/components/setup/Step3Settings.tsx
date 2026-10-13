import { useSetupStore, type LyingInstruction } from '../../stores/setupStore';
import { ToggleSwitch } from './ToggleSwitch';

export function Step3Settings() {
  const {
    settings,
    updateSettings,
    nextStep,
    prevStep,
  } = useSetupStore();

  return (
    <div className="max-w-lg mx-auto bg-neutral-50 border border-neutral-200 rounded-xl p-8">
      <div className="mb-6">
        <h2 className="text-lg font-medium text-neutral-900">Game Settings</h2>
        <p className="text-neutral-500 text-sm">Customize game behavior and display options</p>
      </div>

      {/* Timing Section */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-neutral-700 mb-3">Timing</h3>
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          {/* Speed Mode */}
          <div className="flex justify-between items-center mb-4">
            <div>
              <div className="text-sm font-medium text-neutral-900">Speed Mode</div>
              <div className="text-xs text-neutral-500">How fast should the game progress?</div>
            </div>
            <select
              value={settings.speedMode}
              onChange={(e) => updateSettings({ speedMode: e.target.value as 'realtime' | 'fast' })}
              className="px-3 py-2 border border-neutral-200 rounded-md text-sm bg-white min-w-36 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              <option value="realtime">Realtime (delays)</option>
              <option value="fast">Fast (no delays)</option>
            </select>
          </div>

          {/* Delay Slider */}
          {settings.speedMode === 'realtime' && (
            <div className="pt-3 border-t border-neutral-100">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-neutral-500">Action delay</span>
                <span className="text-sm font-medium">{settings.actionDelay.toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={settings.actionDelay}
                onChange={(e) => updateSettings({ actionDelay: parseFloat(e.target.value) })}
                className="w-full accent-neutral-900"
              />
              <div className="flex justify-between text-xs text-neutral-400 mt-1">
                <span>0.5s</span>
                <span>5s</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Display Section */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-neutral-700 mb-3">Display</h3>
        <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
          {/* Show Thoughts */}
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-neutral-900">Show AI Thoughts</div>
              <div className="text-xs text-neutral-500">Display internal reasoning for each action</div>
            </div>
            <ToggleSwitch
              checked={settings.showThoughts}
              onChange={(checked) => updateSettings({ showThoughts: checked })}
            />
          </div>

          {/* Reveal Roles */}
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-neutral-900">Reveal Roles to Viewer</div>
              <div className="text-xs text-neutral-500">Show role badges in UI (AI players never see this)</div>
            </div>
            <ToggleSwitch
              checked={settings.revealRoles}
              onChange={(checked) => updateSettings({ revealRoles: checked })}
            />
          </div>

          {/* Vote History */}
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-neutral-900">Vote History Panel</div>
              <div className="text-xs text-neutral-500">Show voting patterns sidebar</div>
            </div>
            <ToggleSwitch
              checked={settings.showVoteHistory}
              onChange={(checked) => updateSettings({ showVoteHistory: checked })}
            />
          </div>
        </div>
      </div>

      {/* LLM Section */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-neutral-700 mb-3">LLM Behavior</h3>
        <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
          {/* Lying instruction (the experimental condition) */}
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-neutral-900">Lying Instruction</div>
              <div className="text-xs text-neutral-500">What every player is told about lying</div>
            </div>
            <select
              value={settings.lyingInstruction ?? 'allowed'}
              onChange={(e) => updateSettings({ lyingInstruction: e.target.value as LyingInstruction })}
              className="px-3 py-2 border border-neutral-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              <option value="none">Not mentioned</option>
              <option value="allowed">Allowed (default)</option>
              <option value="encouraged">Encouraged</option>
              <option value="forbidden">Forbidden</option>
            </select>
          </div>

          {/* Max Retries */}
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-neutral-900">Max Retries</div>
              <div className="text-xs text-neutral-500">Retries on invalid response format</div>
            </div>
            <select
              value={settings.maxRetries}
              onChange={(e) => updateSettings({ maxRetries: parseInt(e.target.value) })}
              className="px-3 py-2 border border-neutral-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
            </select>
          </div>

          {/* Temperature */}
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-neutral-900">Temperature</div>
              <div className="text-xs text-neutral-500">Creativity level for responses</div>
            </div>
            <select
              value={settings.temperature}
              onChange={(e) => updateSettings({ temperature: parseFloat(e.target.value) })}
              className="px-3 py-2 border border-neutral-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              <option value={0.3}>0.3 (focused)</option>
              <option value={0.7}>0.7 (balanced)</option>
              <option value={1.0}>1.0 (creative)</option>
            </select>
          </div>

          {/* Max Tokens */}
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-neutral-900">Max Tokens</div>
              <div className="text-xs text-neutral-500">Maximum response length per turn</div>
            </div>
            <select
              value={settings.maxTokens}
              onChange={(e) => updateSettings({ maxTokens: parseInt(e.target.value) })}
              className="px-3 py-2 border border-neutral-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              <option value={256}>256 (brief)</option>
              <option value={500}>500 (standard)</option>
              <option value={800}>800 (detailed)</option>
              <option value={1024}>1024 (verbose)</option>
            </select>
          </div>

          {/* Cost Limit */}
          <div className="flex justify-between items-center pt-3 border-t border-neutral-100">
            <div>
              <div className="text-sm text-neutral-900">Cost Limit</div>
              <div className="text-xs text-neutral-500">Auto-pause when cost reaches limit</div>
            </div>
            <select
              value={settings.costLimit}
              onChange={(e) => updateSettings({ costLimit: parseFloat(e.target.value) })}
              className="px-3 py-2 border border-neutral-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              <option value={0.25}>$0.25</option>
              <option value={0.5}>$0.50</option>
              <option value={1}>$1.00</option>
              <option value={2}>$2.00</option>
              <option value={5}>$5.00</option>
              <option value={10}>$10.00</option>
              <option value={9999}>No limit</option>
            </select>
          </div>
        </div>
      </div>

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
          className="px-6 py-3.5 bg-neutral-900 text-white rounded-lg text-sm font-medium hover:bg-neutral-800 transition-colors"
        >
          Review & Start →
        </button>
      </div>
    </div>
  );
}
