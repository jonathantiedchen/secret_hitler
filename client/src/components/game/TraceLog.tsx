import { useEffect, useRef, useState } from 'react';
import type { TraceEntry } from '../../stores/gameStore';

interface TraceLogProps {
  entries: TraceEntry[];
  // False once the game is over or aborted: nothing is pending any more
  isActive: boolean;
}

const levelText: Record<TraceEntry['level'], string> = {
  info: 'text-neutral-600',
  warn: 'text-amber-700',
  error: 'text-red-700',
};

const levelDot: Record<TraceEntry['level'], string> = {
  info: 'bg-neutral-300',
  warn: 'bg-amber-500',
  error: 'bg-red-600',
};

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour12: false });

export function TraceLog({ entries, isActive }: TraceLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const [now, setNow] = useState(() => Date.now());

  // Keep following new entries unless the user scrolled up to read
  useEffect(() => {
    const el = scrollRef.current;
    if (el && followLatest.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const last = entries.at(-1);
  const waitingSince = isActive && last?.step === 'request' ? last.timestamp : null;

  // Tick while a request is open, so a slow or hanging model call shows how long it has taken
  useEffect(() => {
    if (waitingSince === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waitingSince]);

  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-neutral-400 text-sm">
        Waiting for the game to start...
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="h-full overflow-y-auto p-3 font-mono text-[11px] leading-relaxed"
    >
      {entries.map((entry, i) => (
        <div key={i} className={`py-1 border-b border-neutral-100 ${levelText[entry.level]}`}>
          <div className="flex items-start gap-2">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${levelDot[entry.level]}`} />
            <span className="text-neutral-400 flex-shrink-0">{formatTime(entry.timestamp)}</span>
            <span className="min-w-0 break-words">
              <span className="font-semibold">{entry.step}</span> {entry.message}
            </span>
          </div>
          {entry.detail && (
            <details className="ml-3.5 mt-1">
              <summary className="cursor-pointer text-neutral-400 hover:text-neutral-600">details</summary>
              <pre className="mt-1 p-2 bg-white border border-neutral-200 rounded whitespace-pre-wrap break-words text-neutral-700">
                {entry.detail}
              </pre>
            </details>
          )}
        </div>
      ))}
      {waitingSince !== null && (
        <div className="py-1 pl-3.5 text-blue-600 animate-pulse">
          waiting for reply… {Math.max(0, Math.round((now - waitingSince) / 1000))}s
        </div>
      )}
    </div>
  );
}
