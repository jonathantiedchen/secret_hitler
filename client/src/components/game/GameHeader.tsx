import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tooltip } from './Tooltip';
import { stepBack, stepForward, goLive } from '../../hooks/useGameSocket';

interface GameHeaderProps {
  round: number;
  cost: number;
  isPaused: boolean;
  gameId: string;
  onPauseToggle: () => void;
  historyIndex: number | null;
  totalSnapshots: number;
  historyDescription: string | null;
}

export function GameHeader({ round, cost, isPaused, gameId, onPauseToggle, historyIndex, totalSnapshots }: GameHeaderProps) {
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);

  const isViewingHistory = historyIndex !== null;
  const canStepBack = totalSnapshots > 0 && (historyIndex === null || historyIndex > 0);
  const canStepForward = historyIndex !== null;

  const handleQuit = () => {
    if (confirm('Are you sure you want to quit this game?')) {
      navigate('/');
    }
  };

  const handleViewAnalysis = () => {
    navigate(`/analysis/${gameId}`);
    setShowMenu(false);
  };

  return (
    <div className="flex justify-between items-center px-6 py-4 border-b border-neutral-200">
      {/* Left: Round + Menu */}
      <div className="flex items-center gap-4">
        <Tooltip content="Each round consists of nomination, voting, and legislation phases" position="bottom">
          <div className="text-neutral-900 text-sm font-medium cursor-help">Round {round}</div>
        </Tooltip>

        {/* Menu Button */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-neutral-100 rounded-lg transition-colors text-neutral-500 hover:text-neutral-900"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Dropdown Menu */}
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute left-0 top-full mt-1 bg-white border border-neutral-200 rounded-lg shadow-xl z-50 min-w-[180px] py-1">
                <button
                  onClick={handleViewAnalysis}
                  className="w-full px-4 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 transition-colors flex items-center gap-2"
                >
                  <span>📊</span>
                  View Analysis
                </button>
                <div className="border-t border-neutral-200 my-1" />
                <button
                  onClick={handleQuit}
                  className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-neutral-50 hover:text-red-600 transition-colors flex items-center gap-2"
                >
                  <span>🚪</span>
                  Quit Game
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: Step Navigation + Pause + Cost */}
      <div className="flex items-center gap-3">
        {/* Step Navigation - only show when paused */}
        {isPaused && totalSnapshots > 0 && (
          <div className="flex items-center gap-1">
            {/* Step Back */}
            <Tooltip content="Previous step" position="bottom">
              <button
                onClick={stepBack}
                disabled={!canStepBack}
                className={`p-1.5 rounded transition-colors ${
                  canStepBack
                    ? 'hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900'
                    : 'text-neutral-300 cursor-not-allowed'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </Tooltip>

            {/* Step indicator */}
            <div className="text-xs text-neutral-500 min-w-[60px] text-center">
              {isViewingHistory ? (
                <span className="text-amber-600 font-medium">
                  {historyIndex + 1}/{totalSnapshots}
                </span>
              ) : (
                <span className="text-green-600 font-medium">Live</span>
              )}
            </div>

            {/* Step Forward */}
            <Tooltip content={isViewingHistory ? "Next step" : "Already live"} position="bottom">
              <button
                onClick={stepForward}
                disabled={!canStepForward}
                className={`p-1.5 rounded transition-colors ${
                  canStepForward
                    ? 'hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900'
                    : 'text-neutral-300 cursor-not-allowed'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </Tooltip>

            {/* Go Live button - show when viewing history */}
            {isViewingHistory && (
              <Tooltip content="Return to live" position="bottom">
                <button
                  onClick={goLive}
                  className="ml-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
                >
                  Live
                </button>
              </Tooltip>
            )}
          </div>
        )}

        {/* Separator when nav is shown */}
        {isPaused && totalSnapshots > 0 && (
          <div className="w-px h-6 bg-neutral-200" />
        )}

        {/* Pause Button */}
        <button
          onClick={onPauseToggle}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            isPaused
              ? 'bg-green-600 hover:bg-green-500 text-white'
              : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'
          }`}
        >
          {isPaused ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Resume
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
              Pause
            </>
          )}
        </button>

        {/* Cost */}
        <Tooltip content="Total API cost for all AI model calls this game" position="left">
          <div className="text-neutral-500 text-sm cursor-help">${cost.toFixed(2)}</div>
        </Tooltip>
      </div>
    </div>
  );
}
