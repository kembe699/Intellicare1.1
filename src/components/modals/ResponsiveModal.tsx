import React from 'react';
import { X } from 'lucide-react';

interface ResponsiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
}

export const ResponsiveModal: React.FC<ResponsiveModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
}) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md sm:max-w-lg',
    lg: 'max-w-lg sm:max-w-2xl',
    full: 'w-full max-w-none',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      {/* Modal Content */}
      <div
        className={`
          w-full ${sizeClasses[size]}
          bg-white rounded-t-2xl sm:rounded-lg
          shadow-2xl
          max-h-[90vh] sm:max-h-[95vh]
          flex flex-col
          animate-slide-up sm:animate-fade-in
        `}
      >
        {/* Modal Header - Fixed */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 truncate pr-4">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition flex-shrink-0 min-h-touch min-w-touch flex items-center justify-center"
            aria-label="Close modal"
          >
            <X size={24} className="text-gray-600" />
          </button>
        </div>

        {/* Modal Body - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </div>

        {/* Add animation styles */}
        <style>{`
          @keyframes slide-up {
            from {
              transform: translateY(100%);
            }
            to {
              transform: translateY(0);
            }
          }

          @keyframes fade-in {
            from {
              opacity: 0;
              transform: scale(0.95);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }

          .animate-slide-up {
            animation: slide-up 0.3s ease-out;
          }

          @media (min-width: 640px) {
            .animate-slide-up {
              animation: fade-in 0.3s ease-out;
            }
          }
        `}</style>
      </div>
    </div>
  );
};
