/**
 * Auth layout wrapping login and register pages.
 * Centers the auth form with subtle branded background.
 * @module app/(auth)/layout
 */

import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="relative z-10 w-full max-w-sm flex flex-col gap-6">
        <Link
          href="/"
          className="flex items-center justify-center gap-2 text-foreground hover:text-primary transition-colors"
        >
          <span className="font-semibold text-lg tracking-tight">
            Evolution Walker
          </span>
        </Link>
        {children}
      </div>
    </div>
  );
}
