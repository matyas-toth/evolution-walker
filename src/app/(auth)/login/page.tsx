/**
 * Login page with email/password form.
 * Uses next-auth signIn with credentials provider.
 * @module app/(auth)/login/page
 */

"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError("")
        setLoading(true)

        try {
            const result = await signIn("credentials", {
                email,
                password,
                redirect: false,
            })

            if (result?.error) {
                setError("Invalid email or password")
            } else {
                router.push("/dashboard")
                router.refresh()
            }
        } catch {
            setError("Something went wrong. Please try again.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-xl font-semibold tracking-tight">Welcome back</CardTitle>
                <CardDescription>Enter your credentials to continue</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {error && (
                        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                            {error}
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            autoFocus
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="password">Password</Label>
                        <Input
                            id="password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                            minLength={6}
                        />
                    </div>

                    <Button type="submit" disabled={loading} className="w-full mt-1">
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Signing in...
                            </>
                        ) : (
                            "Sign in"
                        )}
                    </Button>

                    <p className="text-sm text-center text-muted-foreground">
                        Don&apos;t have an account?{" "}
                        <Link href="/register" className="text-primary hover:underline underline-offset-4">
                            Create one
                        </Link>
                    </p>
                </form>
            </CardContent>
        </Card>
    )
}
