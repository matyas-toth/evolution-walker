import { afterEach, describe, expect, it, vi } from "vitest"
import type { NextAuthConfig } from "next-auth"

const mocks = vi.hoisted(() => ({ configure: vi.fn(), findUser: vi.fn() }))
vi.mock("next-auth", async () => {
    const { CredentialsSignin } = await import("@auth/core/errors")
    return { CredentialsSignin, default: mocks.configure }
})
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser } } }))
vi.mock("@/lib/authAdapter", () => ({ createAuthAdapter: () => ({}) }))

async function configuration(enabled: boolean): Promise<NextAuthConfig> {
    vi.resetModules()
    vi.stubEnv("AUTH_GOOGLE_ID", enabled ? "test-client" : "")
    vi.stubEnv("AUTH_GOOGLE_SECRET", enabled ? "test-secret" : "")
    mocks.configure.mockReturnValue({})
    await import("@/lib/auth")
    return mocks.configure.mock.calls.at(-1)![0]
}

afterEach(() => vi.unstubAllEnvs())

describe("Google authentication configuration", () => {
    it("registers Google only when credentials are configured and retains password authentication", async () => {
        const enabled = await configuration(true)
        expect(enabled.providers.map(provider => typeof provider === "function" ? provider().id : provider.id)).toEqual(["google", "credentials"])
        expect(enabled.session?.strategy).toBe("jwt")
        const google = enabled.providers[0]
        expect(google).not.toHaveProperty("allowDangerousEmailAccountLinking", true)
        const disabled = await configuration(false)
        expect(disabled.providers).toHaveLength(1)
    })

    it("rejects unverified Google identities, allowing verified identities and credentials", async () => {
        const config = await configuration(true)
        const signIn = config.callbacks!.signIn!
        const args = { user: { id: "user" }, account: { provider: "google", providerAccountId: "sub", type: "oidc" as const } }
        expect(await signIn({ ...args, profile: { email_verified: false } })).toBe(false)
        expect(await signIn({ ...args, profile: { email_verified: true } })).toBe(true)
        expect(await signIn({ ...args, account: { ...args.account, provider: "credentials" } })).toBe(true)
    })

    it("does not authenticate passwordless OAuth users with credentials", async () => {
        const config = await configuration(true)
        const provider = config.providers[1] as unknown as { options: Pick<import("next-auth/providers/credentials").CredentialsConfig, "authorize"> }
        mocks.findUser.mockResolvedValue({ id: "user", email: "google@example.test", password: null })
        await expect(provider.options.authorize({ email: "google@example.test", password: "anything" }, new Request("http://localhost"))).rejects.toMatchObject({ code: "invalid_credentials" })
    })
})
