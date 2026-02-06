/**
 * Reusable Panel component for container styling.
 * @module components/ui/Panel
 */

import React from 'react';

export interface PanelProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
}

/**
 * Container panel with shadow and styling
 */
export function Panel({ children, title, className = '' }: PanelProps) {
  return (
    <div
      className={`bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg p-4 ${className}`}
    >
      {title && (
        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
