/**
 * Dashboard shell component with sidebar navigation.
 * Client component providing navigation, user context, and logout functionality.
 * @module components/dashboard/DashboardShell
 */

"use client"

import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import Link from "next/link"
import { LayoutDashboard, Dna, LogOut, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface DashboardShellProps {
    user: { id: string; name: string; email: string }
    children: React.ReactNode
}

const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/creatures", label: "Creatures", icon: Dna },
]

export function DashboardShell({ user, children }: DashboardShellProps) {
    const pathname = usePathname()

    const isActive = (href: string) => {
        if (href === "/dashboard") return pathname === "/dashboard"
        return pathname.startsWith(href)
    }

    return (
        <div className="flex h-screen overflow-hidden">
            <aside className="flex flex-col w-[260px] shrink-0 border-r border-border bg-background">
                <div className="flex items-center gap-2 h-14 px-4 border-b border-border">
                    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="text-primary shrink-0">
                        <circle cx="16" cy="6" r="4" stroke="currentColor" strokeWidth="2.5" />
                        <line x1="16" y1="10" x2="16" y2="22" stroke="currentColor" strokeWidth="2.5" />
                        <line x1="16" y1="14" x2="10" y2="18" stroke="currentColor" strokeWidth="2.5" />
                        <line x1="16" y1="14" x2="22" y2="18" stroke="currentColor" strokeWidth="2.5" />
                        <line x1="16" y1="22" x2="11" y2="29" stroke="currentColor" strokeWidth="2.5" />
                        <line x1="16" y1="22" x2="21" y2="29" stroke="currentColor" strokeWidth="2.5" />
                    </svg>
                    <span className="font-semibold text-sm tracking-tight">Evolution Walker</span>
                </div>

                <nav className="flex-1 py-3 px-2 space-y-1">
                    <TooltipProvider>
                        {navItems.map((item) => {
                            const Icon = item.icon
                            const active = isActive(item.href)
                            return (
                                <Tooltip key={item.href} delayDuration={300}>
                                    <TooltipTrigger asChild>
                                        <Link
                                            href={item.href}
                                            className={cn(
                                                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                                active
                                                    ? "bg-primary/10 text-primary"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                            )}
                                        >
                                            <Icon className="h-4 w-4 shrink-0" />
                                            <span className="flex-1">{item.label}</span>
                                            {active && <ChevronRight className="h-3.5 w-3.5 opacity-50" />}
                                        </Link>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="hidden lg:block">
                                        {item.label}
                                    </TooltipContent>
                                </Tooltip>
                            )
                        })}
                    </TooltipProvider>
                </nav>

                <div className="mt-auto border-t border-border p-3">
                    <div className="flex items-center gap-3 px-2 mb-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                            {(user.name?.[0] ?? user.email[0]).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{user.name || "User"}</p>
                            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                    </div>
                    <Separator className="mb-2" />
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-muted-foreground hover:text-foreground"
                        onClick={() => signOut({ callbackUrl: "/" })}
                    >
                        <LogOut className="mr-2 h-4 w-4" />
                        Sign out
                    </Button>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto">
                {children}
            </main>
        </div>
    )
}
