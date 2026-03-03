/**
 * Dashboard layout with sidebar navigation.
 * Wraps all /dashboard/* pages with navigation, user context, and logout.
 * @module app/dashboard/layout
 */

import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { DashboardShell } from "@/components/dashboard/DashboardShell"

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const session = await auth()
    if (!session?.user) redirect("/login")

    return (
        <DashboardShell
            user={{ id: session.user.id!, name: session.user.name ?? "", email: session.user.email ?? "" }}
        >
            {children}
        </DashboardShell>
    )
}
