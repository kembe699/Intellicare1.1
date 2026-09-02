import React from 'react';

interface ResponsivePageLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
  breadcrumb?: { label: string; href?: string }[];
}

export const ResponsivePageLayout: React.FC<ResponsivePageLayoutProps> = ({
  title,
  subtitle,
  children,
  headerAction,
  breadcrumb,
}) => {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Breadcrumb - Responsive */}
      {breadcrumb && (
        <div className="px-4 py-3 sm:px-6 sm:py-4 bg-white border-b border-gray-200">
          <nav className="flex gap-2 text-xs sm:text-sm text-gray-600 overflow-x-auto">
            {breadcrumb.map((item, index) => (
              <React.Fragment key={index}>
                {index > 0 && <span className="text-gray-400">/</span>}
                {item.href ? (
                  <a href={item.href} className="text-teal-600 hover:text-teal-700">
                    {item.label}
                  </a>
                ) : (
                  <span className="text-gray-900 font-medium">{item.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        </div>
      )}

      {/* Page Header - Responsive */}
      <div className="px-4 py-4 sm:px-6 sm:py-6 bg-white border-b border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm sm:text-base text-gray-600 mt-1">
                {subtitle}
              </p>
            )}
          </div>
          {headerAction && (
            <div className="flex gap-2 flex-shrink-0">
              {headerAction}
            </div>
          )}
        </div>
      </div>

      {/* Page Content - Responsive */}
      <div className="px-4 py-4 sm:px-6 sm:py-6">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
};
