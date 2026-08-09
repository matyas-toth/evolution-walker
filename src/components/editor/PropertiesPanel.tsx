/**
 * Context-sensitive properties panel for the creature editor.
 * Shows editable fields for the selected particle, constraint, or muscle.
 * @module components/editor/PropertiesPanel
 */

"use client"

import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import type { LocomotionAnatomy, Topology, TopologyParticle, TopologyConstraint, TopologyMuscle } from "@/core/types"
import type { SelectedElement, EditorTool } from "@/hooks/useEditorState"
import { compileFunctionalAnatomy } from "@/core/training/locomotion"

interface PropertiesPanelProps {
    topology: Topology
    selected: SelectedElement | null
    tool: EditorTool
    onUpdateParticle: (id: string, updates: Partial<TopologyParticle>) => void
    onUpdateConstraint: (id: string, updates: Partial<TopologyConstraint>) => void
    onUpdateMuscle: (id: string, updates: Partial<TopologyMuscle>) => void
    anatomySelection: string[]
    onUpdateLocomotion: (locomotion?: LocomotionAnatomy) => void
}

function NumberField({ label, value, onChange, min, max, step = 0.1 }: {
    label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            <Input
                type="number"
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                min={min}
                max={max}
                step={step}
                className="h-8 text-sm font-mono"
            />
        </div>
    )
}

export function PropertiesPanel({
    topology, selected, tool, onUpdateParticle, onUpdateConstraint, onUpdateMuscle, anatomySelection, onUpdateLocomotion,
}: PropertiesPanelProps) {
    const inferredAnatomy = useMemo(() => compileFunctionalAnatomy({ ...topology, locomotion: undefined }), [topology])

    if (tool === "anatomy") {
        const explicit = topology.locomotion
        const selectedSet = new Set(anatomySelection)
        const updateRole = (role: "coreParticleIds" | "protectedParticleIds") => {
            const current = new Set(explicit?.[role] ?? [])
            const shouldRemove = anatomySelection.length > 0 && anatomySelection.every((id) => current.has(id))
            for (const id of anatomySelection) shouldRemove ? current.delete(id) : current.add(id)
            onUpdateLocomotion({ ...explicit, [role]: Array.from(current) })
        }
        const createGroup = () => {
            if (!anatomySelection.length) return
            const groups = (explicit?.contactGroups ?? [])
                .map((group) => ({ ...group, particleIds: group.particleIds.filter((id) => !selectedSet.has(id)) }))
                .filter((group) => group.particleIds.length)
            let suffix = groups.length + 1
            while (groups.some((group) => group.id === `contact-${suffix}`)) suffix++
            groups.push({ id: `contact-${suffix}`, particleIds: [...anatomySelection] })
            onUpdateLocomotion({ ...explicit, contactGroups: groups })
        }
        const removeAssignments = () => onUpdateLocomotion({
            ...explicit,
            coreParticleIds: explicit?.coreParticleIds?.filter((id) => !selectedSet.has(id)),
            protectedParticleIds: explicit?.protectedParticleIds?.filter((id) => !selectedSet.has(id)),
            contactGroups: explicit?.contactGroups
                ?.map((group) => ({ ...group, particleIds: group.particleIds.filter((id) => !selectedSet.has(id)) }))
                .filter((group) => group.particleIds.length),
        })

        return (
            <div className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-border bg-card p-4">
                <div>
                    <h3 className="text-sm font-semibold">Locomotion Anatomy</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Select any number of endpoint particles, then describe their functional role. Branch muscles are compiled automatically.</p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Selected</span><span className="font-mono">{anatomySelection.length}</span></div>
                    <p className="mt-2 break-words font-mono text-[10px] text-muted-foreground">{anatomySelection.join(", ") || "Click particles on the canvas"}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" disabled={!anatomySelection.length} onClick={() => updateRole("coreParticleIds")}>Toggle core</Button>
                    <Button size="sm" variant="outline" disabled={!anatomySelection.length} onClick={() => updateRole("protectedParticleIds")}>Toggle protected</Button>
                    <Button size="sm" disabled={!anatomySelection.length} onClick={createGroup}>New contact group</Button>
                    <Button size="sm" variant="ghost" disabled={!anatomySelection.length} onClick={removeAssignments}>Clear roles</Button>
                </div>
                <Separator />
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">Contact groups</Label>
                        <span className="font-mono text-xs text-muted-foreground">{explicit?.contactGroups?.length ?? 0}</span>
                    </div>
                    {(explicit?.contactGroups ?? []).map((group) => (
                        <div key={group.id} className="rounded-md border border-border/60 p-2 text-xs">
                            <div className="font-mono font-medium">{group.id}</div>
                            <div className="my-1 truncate text-[10px] text-muted-foreground">{group.particleIds.join(", ")}</div>
                            <Label className="text-[10px] text-muted-foreground">Paired with</Label>
                            <select
                                value={group.pairedWith ?? ""}
                                onChange={(event) => {
                                    const pairedWith = event.target.value || undefined
                                    onUpdateLocomotion({
                                        ...explicit,
                                        contactGroups: explicit?.contactGroups?.map((candidate) => {
                                            if (candidate.id === group.id) return { ...candidate, pairedWith }
                                            if (candidate.id === pairedWith) return { ...candidate, pairedWith: group.id }
                                            if (candidate.pairedWith === group.id || candidate.pairedWith === pairedWith) {
                                                return { ...candidate, pairedWith: undefined }
                                            }
                                            return candidate
                                        }),
                                    })
                                }}
                                className="mt-1 h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                            >
                                <option value="">Unpaired</option>
                                {(explicit?.contactGroups ?? []).filter((candidate) => candidate.id !== group.id).map((candidate) => (
                                    <option key={candidate.id} value={candidate.id}>{candidate.id}</option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>
                <Separator />
                <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between"><span className="font-medium">Inference preview</span><span className="text-muted-foreground">deterministic</span></div>
                    <p className="text-muted-foreground">{inferredAnatomy.coreIndices.length} core particles · {inferredAnatomy.contactGroups.length} distal contact groups · {inferredAnatomy.muscleGroup.filter((value) => value >= 0).length} branch muscles</p>
                    <Button size="sm" variant="secondary" className="w-full" onClick={() => onUpdateLocomotion(undefined)}>Use automatic inference</Button>
                    {!explicit?.contactGroups?.length && explicit ? <p className="text-amber-600 dark:text-amber-400">No explicit contact group is assigned; training will infer effectors.</p> : null}
                </div>
            </div>
        )
    }

    if (!selected) {
        return (
            <div className="w-64 shrink-0 border-l border-border bg-card p-4">
                <h3 className="text-sm font-semibold mb-3">Properties</h3>
                <p className="text-xs text-muted-foreground mb-4">Select an element to edit its properties</p>
                <Separator className="mb-4" />
                <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                        <span>Particles</span>
                        <span className="font-mono">{topology.particles.length}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Constraints</span>
                        <span className="font-mono">{topology.constraints.length}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Muscles</span>
                        <span className="font-mono">{topology.muscles.length}</span>
                    </div>
                </div>
                <Separator className="my-4" />
                <div className="text-xs text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">Tool: {tool}</p>
                    <p>Click canvas to place particles. Click two particles to create constraints or muscles.</p>
                </div>
            </div>
        )
    }

    if (selected.type === "particle") {
        const particle = topology.particles.find((p) => p.id === selected.id)
        if (!particle) return null

        return (
            <div className="w-64 shrink-0 border-l border-border bg-card p-4">
                <h3 className="text-sm font-semibold mb-1">Particle</h3>
                <p className="text-xs text-muted-foreground font-mono mb-4">{particle.id}</p>
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                        <NumberField label="X" value={Math.round(particle.initialPos.x * 10) / 10} onChange={(x) => onUpdateParticle(particle.id, { initialPos: { ...particle.initialPos, x } })} step={1} />
                        <NumberField label="Y" value={Math.round(particle.initialPos.y * 10) / 10} onChange={(y) => onUpdateParticle(particle.id, { initialPos: { ...particle.initialPos, y } })} step={1} />
                    </div>
                    <NumberField label="Mass" value={particle.mass} onChange={(mass) => onUpdateParticle(particle.id, { mass })} min={0.1} max={10} step={0.1} />
                    <NumberField label="Radius" value={particle.radius} onChange={(radius) => onUpdateParticle(particle.id, { radius })} min={1} max={20} step={1} />
                    <div className="flex items-center justify-between pt-1">
                        <Label className="text-xs text-muted-foreground">Locked</Label>
                        <Switch
                            checked={particle.isLocked}
                            onCheckedChange={(isLocked) => onUpdateParticle(particle.id, { isLocked })}
                        />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                        <Label className="text-xs text-muted-foreground">Is Head</Label>
                        <Switch
                            checked={particle.isHead || false}
                            onCheckedChange={(isHead) => {
                                if (isHead) {
                                    onUpdateParticle(particle.id, { isHead: true });
                                }
                            }}
                            disabled={particle.isHead}
                        />
                    </div>
                </div>
            </div>
        )
    }

    if (selected.type === "constraint") {
        const constraint = topology.constraints.find((c) => c.id === selected.id)
        if (!constraint) return null

        return (
            <div className="w-64 shrink-0 border-l border-border bg-card p-4">
                <h3 className="text-sm font-semibold mb-1">Constraint</h3>
                <p className="text-xs text-muted-foreground font-mono mb-4">{constraint.id}</p>
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <Label className="text-xs text-muted-foreground">From</Label>
                            <p className="font-mono text-sm mt-0.5">{constraint.p1Id}</p>
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">To</Label>
                            <p className="font-mono text-sm mt-0.5">{constraint.p2Id}</p>
                        </div>
                    </div>
                    <NumberField label="Rest Length" value={Math.round(constraint.restLength * 10) / 10} onChange={(restLength) => onUpdateConstraint(constraint.id, { restLength })} min={1} step={1} />
                    <NumberField label="Stiffness" value={constraint.stiffness} onChange={(stiffness) => onUpdateConstraint(constraint.id, { stiffness })} min={0} max={1} step={0.05} />
                    <NumberField label="Damping" value={constraint.damping} onChange={(damping) => onUpdateConstraint(constraint.id, { damping })} min={0} max={1} step={0.01} />
                </div>
            </div>
        )
    }

    if (selected.type === "muscle") {
        const muscle = topology.muscles.find((m) => m.id === selected.id)
        if (!muscle) return null

        return (
            <div className="w-64 shrink-0 border-l border-border bg-card p-4">
                <h3 className="text-sm font-semibold mb-1">Muscle</h3>
                <p className="text-xs text-muted-foreground font-mono mb-4">{muscle.id}</p>
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <Label className="text-xs text-muted-foreground">From</Label>
                            <p className="font-mono text-sm mt-0.5">{muscle.p1Id}</p>
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">To</Label>
                            <p className="font-mono text-sm mt-0.5">{muscle.p2Id}</p>
                        </div>
                    </div>
                    <NumberField label="Base Length" value={Math.round(muscle.baseLength * 10) / 10} onChange={(baseLength) => onUpdateMuscle(muscle.id, { baseLength })} min={1} step={1} />
                    <NumberField label="Stiffness" value={muscle.stiffness} onChange={(stiffness) => onUpdateMuscle(muscle.id, { stiffness })} min={0} max={1} step={0.05} />
                    <NumberField label="Damping" value={muscle.damping} onChange={(damping) => onUpdateMuscle(muscle.id, { damping })} min={0} max={1} step={0.01} />
                </div>
            </div>
        )
    }

    return null
}
