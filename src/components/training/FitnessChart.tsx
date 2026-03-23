"use client"

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { FitnessDataPoint } from "@/hooks/useEvolution"

interface FitnessChartProps {
    data: FitnessDataPoint[]
}

export function FitnessChart({ data }: FitnessChartProps) {
    if (data.length === 0) {
        return (
            <div className="flex-1 w-full h-full flex items-center justify-center text-sm text-muted-foreground bg-muted/20 border-t border-border">
                No generation data yet
            </div>
        )
    }

    return (
        <div className="flex-1 w-full h-full min-h-[150px] p-4 bg-muted/10 border-t border-border flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2 px-2 uppercase tracking-wider">Evolution Progress</h3>
            <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
                        <XAxis
                            dataKey="generation"
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            domain={['auto', 'auto']}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                            itemStyle={{ color: "hsl(var(--foreground))" }}
                        />
                        <Line
                            type="monotone"
                            dataKey="bestFitness"
                            name="Max Fitness"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="averageFitness"
                            name="Avg Fitness"
                            stroke="hsl(var(--muted-foreground))"
                            strokeWidth={1.5}
                            dot={false}
                            isAnimationActive={false}
                            strokeDasharray="4 4"
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
