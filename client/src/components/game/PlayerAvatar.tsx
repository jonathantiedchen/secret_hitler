import type { Vote, Role } from '../../stores/gameStore';
import { VoteBadge } from './VoteBadge';
import { Tooltip } from './Tooltip';

interface PlayerAvatarProps {
  name: string;
  icon: string;
  color: string;
  role: Role;
  isAlive: boolean;
  isPresident: boolean;
  isChancellor: boolean;
  isNominee?: boolean;
  vote: Vote;
  showVotes: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}

export function PlayerAvatar({
  name,
  icon,
  color,
  role,
  isAlive,
  isPresident,
  isChancellor,
  isNominee = false,
  vote,
  showVotes,
  isSelected = false,
  onClick,
}: PlayerAvatarProps) {
  const opacity = isAlive ? (isPresident || isChancellor ? 1 : 0.6) : 0.2;
  const bgColor = isAlive ? color : '#d1d5db';

  // Border color based on role
  let borderClass = '';
  if (isPresident) {
    borderClass = 'border-2 border-amber-500'; // Gold for president
  } else if (isChancellor) {
    borderClass = 'border-2 border-neutral-900'; // Dark for chancellor
  }

  // Role label and tooltip
  let roleLabel = '';
  let roleColor = '';
  let roleTooltip = '';
  if (isPresident) {
    roleLabel = 'President';
    roleColor = 'text-amber-600';
    roleTooltip = 'Nominates a Chancellor and draws 3 policy cards, discarding 1';
  } else if (isChancellor) {
    roleLabel = 'Chancellor';
    roleColor = 'text-neutral-900';
    roleTooltip = 'Receives 2 policies from the President and enacts 1';
  } else if (isNominee) {
    roleLabel = 'Nominee';
    roleColor = 'text-neutral-500';
    roleTooltip = 'Nominated for Chancellor, awaiting vote';
  }

  // Can vote: alive and not president or nominee
  const canVote = isAlive && !isNominee;

  // Role badge config
  const getRoleBadge = () => {
    switch (role) {
      case 'hitler':
        return { label: 'Hitler', bgColor: 'bg-red-100', textColor: 'text-red-700' };
      case 'fascist':
        return { label: 'Fascist', bgColor: 'bg-red-50', textColor: 'text-red-600' };
      case 'liberal':
        return { label: 'Liberal', bgColor: 'bg-blue-50', textColor: 'text-blue-600' };
      default:
        return null;
    }
  };
  const roleBadge = getRoleBadge();

  const avatarContent = (
    <div
      className="text-center w-[72px] cursor-pointer"
      style={{ opacity }}
      onClick={onClick}
    >
      <div
        className={`w-12 h-12 rounded-xl mx-auto flex items-center justify-center text-2xl ${borderClass} ${
          isSelected ? 'ring-2 ring-neutral-400' : ''
        }`}
        style={{ backgroundColor: bgColor }}
      >
        {icon}
      </div>
      <div className={`text-xs mt-1.5 ${isAlive ? 'text-neutral-900' : 'text-neutral-400'}`}>
        {name}
      </div>
      {roleLabel ? (
        <div className={`text-[10px] ${roleColor}`}>{roleLabel}</div>
      ) : (
        <div className="h-3.5" /> // Spacer for alignment
      )}
      {/* Secret role badge */}
      {roleBadge && (
        <div className={`text-[9px] px-1.5 py-0.5 rounded mt-0.5 ${roleBadge.bgColor} ${roleBadge.textColor}`}>
          {roleBadge.label}
        </div>
      )}
      {showVotes && <VoteBadge vote={vote} canVote={canVote} />}
    </div>
  );

  // Wrap with tooltip if player has a role
  if (roleTooltip) {
    return (
      <Tooltip content={roleTooltip} position="top">
        {avatarContent}
      </Tooltip>
    );
  }

  return avatarContent;
}
