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
            <div className="mb-2 flex items-center gap-4 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>Adaptive Locomotion</span>
                <span className="text-emerald-400">Task progress</span>
                <span className="text-sky-400">Gait quality</span>
                <span className="text-amber-400">Archive coverage</span>
            </div>
            <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
                        <XAxis
                            dataKey="generation"
                            stroke="rgba(255, 255, 255, 0.3)"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            yAxisId="quality"
                            stroke="rgba(255, 255, 255, 0.3)"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, 100]}
                            width={34}
                        />
                        <YAxis
                            yAxisId="task"
                            orientation="right"
                            stroke="rgba(46, 204, 113, 0.55)"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, 'auto']}
                            width={34}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: "#1a1a1a", borderColor: "#333", borderRadius: "8px", fontSize: "12px", color: "#fff" }}
                            itemStyle={{ color: "#fff" }}
                        />
                        <Line
                            type="monotone"
                            dataKey="taskProgress"
                            yAxisId="task"
                            name="Task Progress (body lengths)"
                            stroke="#2ecc71"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="locomotionQuality"
                            yAxisId="quality"
                            name="Locomotion Quality"
                            stroke="#38bdf8"
                            strokeWidth={1.5}
                            dot={false}
                            isAnimationActive={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="archiveCoverage"
                            yAxisId="quality"
                            name="Archive Coverage (%)"
                            stroke="#f59e0b"
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
