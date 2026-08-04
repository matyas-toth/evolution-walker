/**
 * Landing page for Evolution Walker.
 * Shows animated background with login/register CTAs.
 * Redirects to /dashboard if already authenticated.
 * @module app/page
 */

import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LandingPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      <div className="relative z-10 flex flex-col items-center gap-8 px-6 text-center max-w-lg">
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-4xl font-bold tracking-tight">
            Evolution Walker
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Design soft-body creatures and watch them learn to walk through
            genetic evolution
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
      </div>

      <div className="absolute bottom-6 text-xs text-muted-foreground/50">
        Built for thesis research on evolutionary algorithms
      </div>
    </div>
  );
}
