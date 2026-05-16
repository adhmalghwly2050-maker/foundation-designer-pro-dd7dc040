import { FileText, Settings2, Compass, FolderOpen, Cpu } from 'lucide-react';

export type MainTab = 'reports' | 'inputs' | 'modeling' | 'projects' | 'solver';

interface BottomNavProps {
  activeTab: MainTab;
  onTabChange: (tab: MainTab) => void;
}

const tabs: { id: MainTab; labelAr: string; icon: typeof FileText }[] = [
  { id: 'projects', labelAr: 'المشاريع', icon: FolderOpen },
  { id: 'inputs',   labelAr: 'المدخلات', icon: Settings2 },
  { id: 'modeling', labelAr: 'النمذجة',  icon: Compass },
  { id: 'solver',   labelAr: 'الحلّال',  icon: Cpu },
  { id: 'reports',  labelAr: 'التقارير', icon: FileText },
];

export default function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`bottom-nav-item${isActive ? ' active' : ''}`}
          >
            <span className="bottom-nav-icon-wrap">
              {isActive && <span className="bottom-nav-pill" />}
              <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} className="bottom-nav-icon" />
            </span>
            <span className="bottom-nav-label">{tab.labelAr}</span>
          </button>
        );
      })}
    </nav>
  );
}
