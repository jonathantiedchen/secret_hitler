import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetupStore } from '../stores/setupStore';
import { useGameStore } from '../stores/gameStore';
import { createGame, startGame } from '../hooks/useGameSocket';
import { ProgressIndicator } from '../components/setup/ProgressIndicator';
import { Step1ApiKey } from '../components/setup/Step1ApiKey';
import { Step2Players } from '../components/setup/Step2Players';
import { Step3Settings } from '../components/setup/Step3Settings';
import { Step4Start } from '../components/setup/Step4Start';

export function SetupPage() {
  const navigate = useNavigate();
  const [isStarting, setIsStarting] = useState(false);
  const initializeGame = useGameStore((state) => state.initializeGame);
  const setGameId = useGameStore((state) => state.setGameId);
  const {
    currentStep,
    setStep,
    setValidating,
    setValidationError,
    setValidated,
    setMockMode,
    setAvailableModels,
    apiKey,
    players,
    settings,
    isMockMode,
    nextStep,
  } = useSetupStore();

  const handleValidateApiKey = async () => {
    setValidating(true);
    setValidationError(null);

    try {
      // Validate API key format
      if (!apiKey.startsWith('sk-or-')) {
        throw new Error('Invalid API key format. Key should start with "sk-or-"');
      }

      // Call OpenRouter API to validate and fetch models
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key. Please check your key and try again.');
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // Transform models to our format
      const models = data.data.map((model: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }) => ({
        id: model.id,
        name: model.name || model.id.split('/').pop(),
        provider: model.id.split('/')[0],
        context: model.context_length || 4096,
        pricing: {
          prompt: parseFloat(model.pricing?.prompt || '0') * 1000000,
          completion: parseFloat(model.pricing?.completion || '0') * 1000000,
        },
      }));

      setAvailableModels(models);
      setMockMode(false); // Clear mock mode when API key is validated
      setValidated(true);
      nextStep();
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Failed to validate API key');
    } finally {
      setValidating(false);
    }
  };

  const handleStart = async () => {
    if (isStarting) return;
    setIsStarting(true);

    try {
      // Create game on server
      const gameId = await createGame(
        players,
        isMockMode ? null : apiKey,
        {
          actionDelay: settings.actionDelay,
          showThoughts: settings.showThoughts,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          costLimit: settings.costLimit,
        }
      );

      // Initialize local game state
      initializeGame(players);
      setGameId(gameId);

      // Start the game loop on server
      await startGame(gameId);

      // Navigate to game screen
      navigate(`/game/${gameId}`);
    } catch (error) {
      console.error('Failed to start game:', error);
      alert('Failed to start game. Is the server running?');
    } finally {
      setIsStarting(false);
    }
  };

  const handleEditStep = (step: number) => {
    setStep(step);
  };

  return (
    <div className="min-h-screen bg-white py-10 px-4">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-neutral-900">
          🎭 Secret Hitler LLM Arena
        </h1>
        {currentStep === 1 && (
          <p className="text-neutral-500 mt-1">Watch AI models deceive each other</p>
        )}
      </div>

      {/* Progress Indicator */}
      <ProgressIndicator
        currentStep={currentStep}
        onStepClick={handleEditStep}
      />

      {/* Step Content */}
      {currentStep === 1 && (
        <Step1ApiKey onValidate={handleValidateApiKey} />
      )}
      {currentStep === 2 && <Step2Players />}
      {currentStep === 3 && <Step3Settings />}
      {currentStep === 4 && (
        <Step4Start
          onStart={handleStart}
          onEditStep={handleEditStep}
        />
      )}
    </div>
  );
}
