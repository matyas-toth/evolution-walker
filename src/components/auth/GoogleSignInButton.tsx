"use client"

import { useEffect, useState } from "react"
import { getProviders, signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"

/** Shows only configured OAuth providers; credentials and secrets stay server-side. */
export function GoogleSignInButton({ disabled = false }: { disabled?: boolean }) {
    const [available, setAvailable] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let active = true
        getProviders().then(providers => {
            if (active) setAvailable(Boolean(providers?.google))
        }).catch(() => {
            // Password authentication stays usable if provider discovery fails.
        })
        const oauthError = new URLSearchParams(window.location.search).get("error")
        if (oauthError) {
            setError(oauthError === "OAuthAccountNotLinked"
                ? "This email already has an account. Sign in with your password instead."
                : "Google sign-in failed. Please try again or sign in with your password.")
        }
        return () => { active = false }
    }, [])

    async function login() {
        setLoading(true)
        setError(null)
        try {
            await signIn("google", { redirectTo: "/dashboard" })
        } catch {
            setError("Google sign-in could not be started. Please try again.")
        } finally {
            setLoading(false)
        }
    }

    return <>
        {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
        {available && <div className="mb-4 space-y-4">
            <Button type="button" variant="outline" className="w-full" disabled={disabled || loading} onClick={login}>
                {loading ? "Connecting to Google..." : "Continue with Google"}
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />or use email<span className="h-px flex-1 bg-border" />
            </div>
        </div>}
    </>
}
