import React, { useState } from 'react';
import { Sidebar, MobileHeader, TopBar } from './Sidebar';
import { FloatingAssistantButton } from '@/components/common/FloatingAssistantButton';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <MobileHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
      <TopBar />

      <main className="lg:ml-64 pt-16 lg:pt-14 min-h-screen">
        <div className="p-3 lg:p-4">
          {children}
        </div>
      </main>

      <FloatingAssistantButton />
    </div>
  );
};
