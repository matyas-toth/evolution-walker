// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

const auth = vi.hoisted(() => ({ getProviders: vi.fn(), signIn: vi.fn() }))
vi.mock("next-auth/react", () => auth)
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton"

afterEach(() => window.history.replaceState(null, "", "/"))

it("does not offer Google when no provider is configured", async () => {
    auth.getProviders.mockResolvedValue({ credentials: {} })
    render(<GoogleSignInButton />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
})

it("starts Google OAuth with the dashboard callback", async () => {
    auth.getProviders.mockResolvedValue({ google: {} })
    auth.signIn.mockResolvedValue(undefined)
    render(<GoogleSignInButton />)
    await userEvent.click(await screen.findByRole("button", { name: "Continue with Google" }))
    expect(auth.signIn).toHaveBeenCalledWith("google", { redirectTo: "/dashboard" })
})

it("reports an initiation failure without leaving a disabled button", async () => {
    auth.getProviders.mockResolvedValue({ google: {} })
    auth.signIn.mockRejectedValue(new Error("Offline"))
    render(<GoogleSignInButton />)
    await userEvent.click(await screen.findByRole("button", { name: "Continue with Google" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be started")
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled()
})

it("explains email collisions without implicitly linking accounts", async () => {
    window.history.replaceState(null, "", "/login?error=OAuthAccountNotLinked")
    auth.getProviders.mockResolvedValue({ google: {} })
    render(<GoogleSignInButton />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in with your password instead")
})
