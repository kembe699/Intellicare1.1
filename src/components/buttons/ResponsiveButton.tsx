import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ResponsiveButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const ResponsiveButton: React.FC<ResponsiveButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isLoading = false,
  leftIcon,
  rightIcon,
  children,
  disabled,
  ...props
}) => {
  // Base classes
  const baseClasses = 'font-medium rounded-lg transition duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 inline-flex items-center justify-center gap-2 whitespace-nowrap';

  // Variant classes
  const variantClasses = {
    primary: 'bg-teal-600 text-white hover:bg-teal-700 focus:ring-teal-500 active:bg-teal-800',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-400 active:bg-gray-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 active:bg-red-800',
    ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 focus:ring-gray-300 active:bg-gray-200',
  };

  // Size classes - Mobile-first
  const sizeClasses = {
    sm: 'px-3 sm:px-4 py-2 sm:py-2 text-xs sm:text-sm min-h-[44px] sm:min-h-[40px]',
    md: 'px-4 sm:px-6 py-2 sm:py-3 text-sm sm:text-base min-h-[48px] sm:min-h-[44px]',
    lg: 'px-6 sm:px-8 py-3 sm:py-4 text-base sm:text-lg min-h-[52px] sm:min-h-[48px]',
  };

  // Disabled state
  const disabledClasses = disabled || isLoading ? 'opacity-50 cursor-not-allowed' : '';

  // Full width
  const widthClasses = fullWidth ? 'w-full' : '';

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${disabledClasses} ${widthClasses}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {leftIcon && !isLoading && <span>{leftIcon}</span>}
      {isLoading && (
        <span className="inline-block animate-spin">⏳</span>
      )}
      {children}
      {rightIcon && !isLoading && <span>{rightIcon}</span>}
    </button>
  );
};
