interface ActionEventProps {
  content: string;
  variant?: 'default' | 'success' | 'danger';
}

export function ActionEvent({ content, variant = 'default' }: ActionEventProps) {
  const iconColor = {
    default: '#737373',
    success: '#16a34a',
    danger: '#dc2626',
  }[variant];

  const icon = {
    default: '⚡',
    success: '✓',
    danger: '✗',
  }[variant];

  return (
    <div className="bg-neutral-100 rounded-md py-2 px-3 mb-2.5 text-xs text-neutral-500">
      <span style={{ color: iconColor }}>{icon}</span> {content}
    </div>
  );
}
