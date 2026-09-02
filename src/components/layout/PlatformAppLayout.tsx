import React, { useState } from 'react';
import { PlatformSidebar, PlatformMobileHeader, PlatformTopBar } from './PlatformSidebar';

interface PlatformAppLayoutProps {
  children: React.ReactNode;
}

export const PlatformAppLayout: React.FC<PlatformAppLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <PlatformSidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <PlatformMobileHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
      <PlatformTopBar />

      <main className="lg:ml-64 pt-16 lg:pt-14 min-h-screen">
        <div className="p-3 lg:p-4">
          {children}
        </div>
      </main>
    </div>
  );
};
