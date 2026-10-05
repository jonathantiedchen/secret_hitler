import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { useGameSocket } from '../hooks/useGameSocket';
import { GameHeader } from '../components/game/GameHeader';
import { PolicyTracks } from '../components/game/PolicyTracks';
import { PlayerRow } from '../components/game/PlayerRow';
import { PhaseStrip } from '../components/game/PhaseStrip';
import { ThoughtPanel } from '../components/game/ThoughtPanel';
import { ChatSidebar } from '../components/game/ChatSidebar';
import { LegislationView } from '../components/game/LegislationView';
import { GameOverOverlay } from '../components/game/GameOverOverlay';
import { DebugPanel } from '../components/game/DebugPanel';

export function GamePage() {
  const [selectedDebugIndex, setSelectedDebugIndex] = useState<number | null>(null);
  const { gameId: urlGameId } = useParams<{ gameId: string }>();
  const storeGameId = useGameStore((state) => state.gameId);
  const gameId = urlGameId || storeGameId;

  // Connect to server via WebSocket
  useGameSocket(gameId || null);

  const {
    round,
    phase,
    liberalPolicies,
    fascistPolicies,
    failedElections,
    players,
    presidentIndex,
    chancellorIndex,
    legislation,
    chatMessages,
    debugEntries,
    winner,
    winCondition,
    pinnedThoughtPlayer,
    isPaused,
    cost,
    historyIndex,
    totalSnapshots,
    historyDescription,
    getActiveThoughtPlayer,
    setPinnedThoughtPlayer,
    togglePause,
  } = useGameStore();

  // Show loading state if no players yet
  if (players.length === 0) {
    return (
      <div className="h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-neutral-400 mb-2">Connecting to game...</div>
          <div className="text-sm text-neutral-300">
            {gameId ? `Game ID: ${gameId}` : 'No game ID'}
          </div>
        </div>
      </div>
    );
  }

  // Get the player whose thoughts are being shown
  const activeThoughtIndex = getActiveThoughtPlayer();
  const activeThoughtPlayer = players[activeThoughtIndex];

  // Determine phase description
  const getPhaseDescription = (): string => {
    switch (phase) {
      case 'nomination':
        return `${players[presidentIndex].name} is choosing a Chancellor`;
      case 'voting':
        return 'Players are voting on the government';
      case 'legislation_president':
        return `${players[presidentIndex].name} is discarding a policy`;
      case 'legislation_chancellor':
        return chancellorIndex !== null
          ? `${players[chancellorIndex].name} is choosing a policy`
          : 'Chancellor is choosing a policy';
      case 'veto_proposed':
        return `${players[presidentIndex].name} is deciding on the Chancellor's veto`;
      case 'policy_enacted':
        return 'A policy has been enacted';
      case 'executive_action':
        return `${players[presidentIndex].name} must use their executive power`;
      case 'game_over':
        return winCondition || 'Game Over';
      default:
        return '';
    }
  };

  // Handle clicking on a player to pin their thoughts
  const handlePlayerClick = (index: number) => {
    if (pinnedThoughtPlayer === index) {
      setPinnedThoughtPlayer(null); // Unpin if clicking same player
    } else {
      setPinnedThoughtPlayer(index);
    }
  };

  // Show voting phase badges
  const showVotes = phase === 'voting';

  // Handle clicking a chat message to show corresponding debug entry
  const handleMessageClick = (playerId: string, timestamp: number) => {
    // Find the debug entry closest to this message's timestamp from the same player
    const matchingEntries = debugEntries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.playerId === playerId)
      .filter(({ entry }) => Math.abs(entry.timestamp - timestamp) < 30000); // Within 30 seconds

    if (matchingEntries.length > 0) {
      // Get the closest one by timestamp
      const closest = matchingEntries.reduce((prev, curr) =>
        Math.abs(curr.entry.timestamp - timestamp) < Math.abs(prev.entry.timestamp - timestamp) ? curr : prev
      );
      setSelectedDebugIndex(closest.index);
    }
  };

  // Show legislation view
  const showLegislation =
    (phase === 'legislation_president' || phase === 'legislation_chancellor') &&
    legislation !== null;

  return (
    <div className="h-screen bg-white grid grid-cols-[1fr_300px_350px] overflow-hidden">
      {/* LEFT: Game Area */}
      <div className="border-r border-neutral-200 flex flex-col overflow-y-auto">
        {/* Header */}
        <GameHeader
          round={round}
          cost={cost}
          isPaused={isPaused}
          gameId={gameId || ''}
          onPauseToggle={togglePause}
          historyIndex={historyIndex}
          totalSnapshots={totalSnapshots}
          historyDescription={historyDescription}
        />

        {/* Policy Tracks */}
        <PolicyTracks
          liberalPolicies={liberalPolicies}
          fascistPolicies={fascistPolicies}
          failedElections={failedElections}
        />

        {/* Player Row */}
        <PlayerRow
          players={players}
          presidentIndex={presidentIndex}
          chancellorIndex={chancellorIndex}
          showVotes={showVotes}
          selectedPlayerIndex={pinnedThoughtPlayer}
          onPlayerClick={handlePlayerClick}
        />

        {/* Legislation View (conditional) */}
        {showLegislation && chancellorIndex !== null && (
          <LegislationView
            legislation={legislation!}
            presidentName={players[presidentIndex].name}
            chancellorName={players[chancellorIndex].name}
            isChancellorPhase={phase === 'legislation_chancellor'}
          />
        )}

        {/* Phase Strip (hide during legislation when LegislationView is shown) */}
        {!showLegislation && (
          <PhaseStrip phase={phase} description={getPhaseDescription()} />
        )}

        {/* Thought Panel */}
        <div className="flex-1">
          {activeThoughtPlayer && (
            <ThoughtPanel
              player={activeThoughtPlayer}
              isPinned={pinnedThoughtPlayer !== null}
            />
          )}
        </div>
      </div>

      {/* MIDDLE: Chat Sidebar */}
      <ChatSidebar messages={chatMessages} onMessageClick={handleMessageClick} />

      {/* RIGHT: Debug Panel */}
      <DebugPanel
        entries={debugEntries}
        selectedIndex={selectedDebugIndex}
        onClearSelection={() => setSelectedDebugIndex(null)}
      />

      {/* Game Over Overlay */}
      {phase === 'game_over' && winner && winCondition && (
        <GameOverOverlay
          winner={winner}
          winCondition={winCondition}
          players={players}
        />
      )}
    </div>
  );
}
