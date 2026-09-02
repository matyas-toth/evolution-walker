/** Next.js 16 proxy boundary for route protection. */
import NextAuth from "next-auth"
import { authConfig } from "@/lib/auth.config"
import { NextResponse } from "next/server"

const { auth } = NextAuth(authConfig)

export const proxy = auth((req) => {
    const { pathname } = req.nextUrl
    const isLoggedIn = Boolean(req.auth)
    const isAuthPage = pathname === "/login" || pathname === "/register"
    const isDashboard = pathname.startsWith("/dashboard")

    if (isDashboard && !isLoggedIn) return NextResponse.redirect(new URL("/login", req.url))
    if (isAuthPage && isLoggedIn) return NextResponse.redirect(new URL("/dashboard", req.url))
    return NextResponse.next()
})

export const config = {
    matcher: ["/dashboard/:path*", "/login", "/register"],
}
