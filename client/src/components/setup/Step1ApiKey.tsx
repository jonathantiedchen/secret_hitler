import { useSetupStore } from '../../stores/setupStore';

interface Step1ApiKeyProps {
  onValidate: () => Promise<void>;
}

export function Step1ApiKey({ onValidate }: Step1ApiKeyProps) {
  const {
    apiKey,
    showApiKey,
    isValidating,
    validationError,
    setApiKey,
    toggleShowApiKey,
    setMockMode,
    nextStep,
  } = useSetupStore();

  const handleValidate = async () => {
    await onValidate();
  };

  const handleMockMode = () => {
    setMockMode(true);
    nextStep();
  };

  return (
    <div className="max-w-md mx-auto bg-neutral-50 border border-neutral-200 rounded-xl p-8">
      <div className="mb-2">
        <h2 className="text-lg font-medium text-neutral-900">Connect to OpenRouter</h2>
      </div>
      <p className="text-neutral-500 text-sm mb-6">
        Enter your API key to access 100+ LLM models
      </p>

      <div className="mb-5">
        <label className="block text-sm font-medium text-neutral-900 mb-1.5">
          API Key
        </label>
        <div className="flex gap-2">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-v1-..."
            className={`
              flex-1 px-3 py-3 border rounded-lg text-sm font-mono
              focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent
              ${validationError
                ? 'border-red-500 focus:ring-red-500'
                : 'border-neutral-300'
              }
            `}
          />
          <button
            type="button"
            onClick={toggleShowApiKey}
            className="px-3 py-3 border border-neutral-300 rounded-lg bg-white hover:bg-neutral-50 transition-colors"
          >
            {showApiKey ? (
              <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
        {validationError && (
          <p className="text-red-500 text-sm mt-1.5">{validationError}</p>
        )}
        <p className="text-xs text-neutral-500 mt-1.5">
          Get your key at{' '}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-900 underline hover:no-underline"
          >
            openrouter.ai/keys
          </a>
        </p>
      </div>

      <div className="text-center text-neutral-400 text-sm my-5">— or —</div>

      <button
        type="button"
        onClick={handleMockMode}
        className="w-full py-3 border border-dashed border-neutral-300 rounded-lg bg-white text-neutral-600 text-sm hover:bg-neutral-50 hover:border-neutral-400 transition-colors"
      >
        🤖 Use Mock Mode (no API key needed)
      </button>

      <div className="mt-6">
        <button
          type="button"
          onClick={handleValidate}
          disabled={isValidating || !apiKey.trim()}
          className={`
            w-full py-3.5 bg-neutral-900 text-white rounded-lg text-sm font-medium
            transition-colors
            ${isValidating || !apiKey.trim()
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-neutral-800'
            }
          `}
        >
          {isValidating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Validating...
            </span>
          ) : (
            'Validate & Continue →'
          )}
        </button>
      </div>
    </div>
  );
}
