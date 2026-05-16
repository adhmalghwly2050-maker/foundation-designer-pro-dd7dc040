import { HardHat } from 'lucide-react';

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

export default function AppHeader({
  title = 'Structural Master',
  subtitle,
  leftSlot,
  rightSlot,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header-logo">
        {leftSlot ?? (
          <div className="app-header-icon">
            <HardHat size={20} strokeWidth={2} />
          </div>
        )}
      </div>

      <div className="app-header-center">
        <h1 className="app-header-title">{title}</h1>
        {subtitle && <p className="app-header-subtitle">{subtitle}</p>}
      </div>

      <div className="app-header-right">
        {rightSlot ?? <div className="w-9 h-9" />}
      </div>
    </header>
  );
}
