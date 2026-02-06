/**
 * Genome display component for visualizing gene values.
 * @module components/genetics/GenomeDisplay
 */

import { Genome } from '@/core/types';
import { Panel } from '@/components/ui/Panel';

export interface GenomeDisplayProps {
  genome: Genome;
  className?: string;
}

/**
 * Displays genome information in a table format
 * Shows muscle ID, amplitude, frequency, and phase for each gene
 */
export function GenomeDisplay({ genome, className = '' }: GenomeDisplayProps) {
  return (
    <Panel title={`Genome (Generation ${genome.generation})`} className={className}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300 dark:border-gray-600">
              <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">
                Muscle
              </th>
              <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">
                Amplitude
              </th>
              <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">
                Frequency
              </th>
              <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">
                Phase
              </th>
            </tr>
          </thead>
          <tbody>
            {genome.genes.map((gene, index) => {
              const muscleName = gene.muscleId
                .replace(/-/g, ' ')
                .replace(/\b\w/g, (l) => l.toUpperCase());
              
              // Color coding for amplitude (low = blue, high = red)
              const amplitudeColor =
                gene.amplitude < 0.3
                  ? 'text-blue-600 dark:text-blue-400'
                  : gene.amplitude < 0.5
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400';
              
              // Color coding for frequency (low = blue, high = red)
              const frequencyColor =
                gene.frequency < 1.0
                  ? 'text-blue-600 dark:text-blue-400'
                  : gene.frequency < 2.0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400';

              return (
                <tr
                  key={gene.muscleId}
                  className={`border-b border-gray-200 dark:border-gray-700 ${
                    index % 2 === 0
                      ? 'bg-gray-50 dark:bg-gray-800/50'
                      : 'bg-white dark:bg-gray-800'
                  }`}
                >
                  <td className="py-1 px-2 font-mono text-xs text-gray-800 dark:text-gray-200">
                    {muscleName}
                  </td>
                  <td className={`py-1 px-2 font-mono ${amplitudeColor}`}>
                    {gene.amplitude.toFixed(3)}
                  </td>
                  <td className={`py-1 px-2 font-mono ${frequencyColor}`}>
                    {gene.frequency.toFixed(2)} Hz
                  </td>
                  <td className="py-1 px-2 font-mono text-gray-600 dark:text-gray-400">
                    {(gene.phase / Math.PI).toFixed(2)}π
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        <div>ID: {genome.id}</div>
        {genome.parentIds && genome.parentIds.length > 0 && (
          <div>Parents: {genome.parentIds.length}</div>
        )}
      </div>
    </Panel>
  );
}
