import { expect, test } from "@playwright/test"
import { assertNoFrameworkOverlay, assertNoSeriousA11yViolations, capturePageFailures } from "./support"

// OAuth initiation is mocked here; no Google accounts, credentials, or outbound login are needed.
for (const path of ["/login", "/register"]) {
    test(`${path} offers configured Google OAuth and starts the redirect`, async ({ page }) => {
        const failures = capturePageFailures(page)
        await page.route("**/api/auth/providers", route => route.fulfill({ json: {
            google: { id: "google", name: "Google", type: "oidc", signinUrl: "/api/auth/signin/google", callbackUrl: "/api/auth/callback/google" },
        } }))
        let signInBody = ""
        await page.route("**/api/auth/signin/google*", route => {
            signInBody = route.request().postData() ?? ""
            return route.fulfill({ json: { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=e2e" } })
        })
        await page.route("https://accounts.google.com/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Google authorization stub</h1>" }))
        await page.goto(path)
        await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible()
        await assertNoSeriousA11yViolations(page)
        await assertNoFrameworkOverlay(page)
        await page.getByRole("button", { name: "Continue with Google" }).click()
        await expect(page.getByRole("heading", { name: "Google authorization stub" })).toBeVisible()
        const parameters = new URLSearchParams(signInBody)
        expect(parameters.get("callbackUrl")).toContain("/dashboard")
        expect(parameters.get("csrfToken")).toBeTruthy()
        expect(failures).toEqual([])
    })
}
