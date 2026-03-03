/**
 * Registration page with name, email, and password form.
 * Calls the register API endpoint then signs in automatically.
 * @module app/(auth)/register/page
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

export default function RegisterPage() {
    const router = useRouter()
    const [name, setName] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError("")

        if (password !== confirmPassword) {
            setError("Passwords do not match")
            return
        }

        setLoading(true)

        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, email, password }),
            })

            const data = await res.json()

            if (!res.ok) {
                setError(data.error ?? "Registration failed")
                return
            }

            const result = await signIn("credentials", {
                email,
                password,
                redirect: false,
            })

            if (result?.error) {
                setError("Account created but sign-in failed. Please log in manually.")
                router.push("/login")
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
                <CardTitle className="text-xl font-semibold tracking-tight">Create an account</CardTitle>
                <CardDescription>Start designing and evolving creatures</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {error && (
                        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                            {error}
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                            id="name"
                            type="text"
                            placeholder="Your name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            autoComplete="name"
                            autoFocus
                        />
                    </div>

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
                            autoComplete="new-password"
                            minLength={6}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="confirm-password">Confirm Password</Label>
                        <Input
                            id="confirm-password"
                            type="password"
                            placeholder="••••••••"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            autoComplete="new-password"
                            minLength={6}
                        />
                    </div>

                    <Button type="submit" disabled={loading} className="w-full mt-1">
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Creating account...
                            </>
                        ) : (
                            "Create account"
                        )}
                    </Button>

                    <p className="text-sm text-center text-muted-foreground">
                        Already have an account?{" "}
                        <Link href="/login" className="text-primary hover:underline underline-offset-4">
                            Sign in
                        </Link>
                    </p>
                </form>
            </CardContent>
        </Card>
    )
}
