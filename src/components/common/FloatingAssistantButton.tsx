import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * The "open the Analytics Assistant" launcher — fixed bottom-right on every
 * authenticated page via AppLayout, same way a ChatGPT-style floating
 * button behaves: click it, land on the full chat page. Hidden on the
 * Assistant page itself (nothing to launch into from there) and for anyone
 * without pages.analytics_assistant.view, so it never advertises a feature
 * a user isn't allowed to open.
 */
export const FloatingAssistantButton: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPrivilege } = useAuth();

  if (!hasPrivilege('pages.analytics_assistant.view')) return null;
  if (location.pathname === '/assistant') return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/assistant')}
      aria-label="Open Analytics Assistant"
      title="Analytics Assistant"
      className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <MessageCircle className="h-6 w-6" />
    </button>
  );
};
