/**
 * Landing page for Evolution Walker.
 * Shows animated background with login/register CTAs.
 * Redirects to /dashboard if already authenticated.
 * @module app/page
 */

import Link from "next/link"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function LandingPage() {
  const session = await auth()
  if (session?.user) redirect("/dashboard")

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.18_0.04_162)_0%,oklch(0.12_0.005_260)_70%)]" />

      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, oklch(0.72 0.17 162) 1px, transparent 0)`,
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8 px-6 text-center max-w-lg">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-primary">
              <circle cx="16" cy="6" r="4" stroke="currentColor" strokeWidth="2" />
              <line x1="16" y1="10" x2="16" y2="22" stroke="currentColor" strokeWidth="2" />
              <line x1="16" y1="14" x2="10" y2="18" stroke="currentColor" strokeWidth="2" />
              <line x1="16" y1="14" x2="22" y2="18" stroke="currentColor" strokeWidth="2" />
              <line x1="16" y1="22" x2="11" y2="29" stroke="currentColor" strokeWidth="2" />
              <line x1="16" y1="22" x2="21" y2="29" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>

          <h1 className="text-4xl font-bold tracking-tight">
            Evolution Walker
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Design soft-body creatures and watch them learn to walk through genetic evolution
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Link
            href="/register"
            className="inline-flex items-center justify-center h-11 px-8 rounded-lg bg-primary text-primary-foreground font-medium text-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Create Account
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-11 px-8 rounded-lg border border-border bg-card text-foreground font-medium text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Log In
          </Link>
        </div>

        <Link
          href="/showcase"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border hover:decoration-foreground"
        >
          View experiments →
        </Link>
      </div>

      <div className="absolute bottom-6 text-xs text-muted-foreground/50">
        Built for thesis research on evolutionary algorithms
      </div>
    </div>
  )
}
