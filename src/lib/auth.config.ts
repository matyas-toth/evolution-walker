import type { NextAuthConfig } from "next-auth"

export const authConfig = {
    providers: [],
    session: { strategy: "jwt" as const },
    pages: {
        signIn: "/login",
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user) token.id = user.id
            return token
        },
        async session({ session, token }) {
            if (session.user) session.user.id = token.id as string
            return session
        },
    },
} satisfies NextAuthConfig
