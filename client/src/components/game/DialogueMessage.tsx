import type { Role } from '../../stores/gameStore';

interface DialogueMessageProps {
  playerName: string;
  playerIcon: string;
  playerColor: string;
  playerRole?: Role;
  content: string;
  onClick?: () => void;
}

export function DialogueMessage({
  playerName,
  playerIcon,
  playerColor,
  playerRole,
  content,
  onClick,
}: DialogueMessageProps) {
  // Role badge config
  const getRoleBadge = () => {
    switch (playerRole) {
      case 'hitler':
        return { label: 'H', bgColor: 'bg-red-100', textColor: 'text-red-700', title: 'Hitler' };
      case 'fascist':
        return { label: 'F', bgColor: 'bg-red-50', textColor: 'text-red-600', title: 'Fascist' };
      case 'liberal':
        return { label: 'L', bgColor: 'bg-blue-50', textColor: 'text-blue-600', title: 'Liberal' };
      default:
        return null;
    }
  };
  const roleBadge = getRoleBadge();

  return (
    <div className={`mb-3 ${onClick ? 'cursor-pointer hover:bg-neutral-50 -mx-2 px-2 py-1 rounded' : ''}`} onClick={onClick}>
      {/* Player Header */}
      <div className="flex items-center gap-1.5 mb-1">
        <div
          className="w-5 h-5 rounded flex items-center justify-center text-[10px]"
          style={{ backgroundColor: playerColor }}
        >
          {playerIcon}
        </div>
        <span className="text-neutral-500 text-[11px]">{playerName}</span>
        {roleBadge && (
          <span
            className={`text-[9px] px-1 rounded ${roleBadge.bgColor} ${roleBadge.textColor}`}
            title={roleBadge.title}
          >
            {roleBadge.label}
          </span>
        )}
      </div>

      {/* Speech Bubble */}
      <div className="bg-white border border-neutral-200 text-neutral-700 py-2.5 px-3 rounded-lg rounded-tl-sm text-[13px] leading-relaxed shadow-sm">
        {content}
      </div>
    </div>
  );
}
