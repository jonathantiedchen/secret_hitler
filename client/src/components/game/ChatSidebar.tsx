import { useEffect, useRef } from 'react';
import type { ChatMessage, Role } from '../../stores/gameStore';
import { useGameStore } from '../../stores/gameStore';
import { DialogueMessage } from './DialogueMessage';
import { ActionEvent } from './ActionEvent';
import { Tooltip } from './Tooltip';

interface ChatSidebarProps {
  messages: ChatMessage[];
  onMessageClick?: (playerId: string, timestamp: number) => void;
}

export function ChatSidebar({ messages, onMessageClick }: ChatSidebarProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const players = useGameStore((state) => state.players);

  // Get player role by ID
  const getPlayerRole = (playerId?: string): Role | undefined => {
    if (!playerId) return undefined;
    return players.find((p) => p.id === playerId)?.role;
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Determine variant for action messages
  const getActionVariant = (content: string): 'default' | 'success' | 'danger' => {
    if (content.toLowerCase().includes('passed') || content.toLowerCase().includes('liberal enacted')) {
      return 'success';
    }
    if (content.toLowerCase().includes('failed') || content.toLowerCase().includes('fascist enacted')) {
      return 'danger';
    }
    return 'default';
  };

  return (
    <div className="bg-neutral-50 flex flex-col h-screen sticky top-0">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-neutral-200 flex-shrink-0">
        <Tooltip
          content="Public dialogue between AI players - this is where they discuss, accuse, defend, and try to deceive each other"
          position="left"
        >
          <div className="text-neutral-500 text-[11px] uppercase tracking-wider cursor-help font-medium">
            💬 Table Chat
          </div>
        </Tooltip>
      </div>

      {/* Messages Feed - scrollable */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {messages.map((message) =>
          message.type === 'dialogue' ? (
            <DialogueMessage
              key={message.id}
              playerName={message.playerName!}
              playerIcon={message.playerIcon!}
              playerColor={message.playerColor!}
              playerRole={getPlayerRole(message.playerId)}
              content={message.content}
              onClick={onMessageClick && message.playerId ? () => onMessageClick(message.playerId!, message.timestamp) : undefined}
            />
          ) : (
            <ActionEvent
              key={message.id}
              content={message.content}
              variant={getActionVariant(message.content)}
            />
          )
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
