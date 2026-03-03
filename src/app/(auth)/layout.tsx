/**
 * Auth layout wrapping login and register pages.
 * Centers the auth form with subtle branded background.
 * @module app/(auth)/layout
 */

import Link from "next/link"

export default function AuthLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-4">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.16_0.03_162)_0%,oklch(0.12_0.005_260)_60%)]" />

            <div className="relative z-10 w-full max-w-sm flex flex-col gap-6">
                <Link href="/" className="flex items-center justify-center gap-2 text-foreground hover:text-primary transition-colors">
                    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" className="text-primary">
                        <circle cx="16" cy="6" r="4" stroke="currentColor" strokeWidth="2" />
                        <line x1="16" y1="10" x2="16" y2="22" stroke="currentColor" strokeWidth="2" />
                        <line x1="16" y1="14" x2="10" y2="18" stroke="currentColor" strokeWidth="2" />
                        <line x1="16" y1="14" x2="22" y2="18" stroke="currentColor" strokeWidth="2" />
                        <line x1="16" y1="22" x2="11" y2="29" stroke="currentColor" strokeWidth="2" />
                        <line x1="16" y1="22" x2="21" y2="29" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    <span className="font-semibold text-lg tracking-tight">Evolution Walker</span>
                </Link>
                {children}
            </div>
        </div>
    )
}
