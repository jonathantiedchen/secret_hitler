import { useEffect, useRef } from 'react';

interface DebugEntry {
  id: string;
  timestamp: number;
  playerId: string;
  playerName: string;
  model: string;
  phase: string;
  prompt: Array<{ role: string; content: string }>;
  response: string;
}

interface DebugPanelProps {
  entries: DebugEntry[];
  selectedIndex?: number | null;
  onClearSelection?: () => void;
}

export function DebugPanel({ entries, selectedIndex, onClearSelection }: DebugPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const phaseLabels: Record<string, string> = {
    nomination: 'Nomination',
    voting: 'Voting',
    legislation_president: 'President Legislation',
    legislation_chancellor: 'Chancellor Legislation',
    veto_proposed: 'Veto Response',
    executive_action: 'Executive Action',
  };

  const formatPrompt = (prompt: Array<{ role: string; content: string }>) => {
    return prompt.map((msg, i) => (
      <div key={i} className="mb-2">
        <div className="text-xs font-medium text-neutral-400 uppercase mb-0.5">
          {msg.role}
        </div>
        <div className="text-xs text-neutral-600 whitespace-pre-wrap font-mono leading-relaxed">
          {msg.content}
        </div>
      </div>
    ));
  };

  const formatResponse = (response: string) => {
    try {
      const parsed = JSON.parse(response);
      return (
        <pre className="text-xs text-neutral-600 whitespace-pre-wrap font-mono leading-relaxed">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch {
      return (
        <div className="text-xs text-neutral-600 whitespace-pre-wrap font-mono">
          {response}
        </div>
      );
    }
  };

  if (entries.length === 0) {
    return (
      <div className="bg-neutral-50 border-l border-neutral-200 h-screen flex flex-col">
        <div className="px-4 py-3.5 border-b border-neutral-200 flex-shrink-0">
          <div className="text-neutral-500 text-[11px] uppercase tracking-wider font-medium">
            🔧 Debug Console
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
          Waiting for AI calls...
        </div>
      </div>
    );
  }

  // Show selected entry or latest entry
  const displayEntry = selectedIndex !== null && selectedIndex !== undefined && entries[selectedIndex]
    ? entries[selectedIndex]
    : entries[entries.length - 1];
  const isShowingSelected = selectedIndex !== null && selectedIndex !== undefined && entries[selectedIndex];

  return (
    <div className="bg-neutral-50 border-l border-neutral-200 h-screen flex flex-col">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-neutral-200 flex-shrink-0">
        <div className="text-neutral-500 text-[11px] uppercase tracking-wider font-medium">
          🔧 Debug Console
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {/* Entry Header */}
        <div className="mb-3 pb-2 border-b border-neutral-200">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-neutral-900 text-sm">{displayEntry.playerName}</span>
              <span className="text-xs text-neutral-400">{phaseLabels[displayEntry.phase] || displayEntry.phase}</span>
            </div>
            {isShowingSelected && onClearSelection && (
              <button
                onClick={onClearSelection}
                className="text-xs text-neutral-400 hover:text-neutral-600"
              >
                Show latest
              </button>
            )}
          </div>
          <div className="text-xs text-neutral-400 font-mono">{displayEntry.model}</div>
          {isShowingSelected && (
            <div className="text-xs text-blue-500 mt-1">Showing selected entry</div>
          )}
        </div>

        {/* Prompt Section */}
        <div className="mb-4">
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
            Prompt
          </div>
          <div className="bg-white border border-neutral-200 rounded p-3 max-h-[300px] overflow-y-auto">
            {formatPrompt(displayEntry.prompt)}
          </div>
        </div>

        {/* Response Section */}
        <div className="mb-4">
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
            Response
          </div>
          <div className="bg-white border border-neutral-200 rounded p-3 max-h-[300px] overflow-y-auto">
            {formatResponse(displayEntry.response)}
          </div>
        </div>

        {/* History count */}
        <div className="text-xs text-neutral-400 text-center">
          {entries.length} total AI calls
        </div>

        <div ref={scrollRef} />
      </div>
    </div>
  );
}
