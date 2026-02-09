/**
 * Web Worker wrapper for evolution calculations
 * Provides a clean API for offloading evolution to a worker thread
 * @module core/genetics/evolutionWorker
 */

import { Genome, FitnessScore } from '@/core/types';

// Worker-compatible creature type (minimal, just genome + fitness)
export interface CreatureData {
  genome: Genome;
  fitness: FitnessScore;
}

// Evolution configuration
export interface EvolutionConfig {
  elitismCount: number;
  parentsTopPercent: number;
  mutationRate: number;
  mutationStrength: number;
  populationSize: number;
  currentGeneration: number;
}

// Input message format
export interface EvolutionInput {
  creatures: CreatureData[];
  config: EvolutionConfig;
}

// Output message format
export interface EvolutionOutput {
  genomes: Genome[];
  error?: string;
}

/**
 * EvolutionWorker - manages Web Worker lifecycle and communication
 */
export class EvolutionWorker {
  private worker: Worker | null = null;
  private pendingResolve: ((output: EvolutionOutput) => void) | null = null;
  private pendingReject: ((error: Error) => void) | null = null;

  constructor() {
    try {
      // For Next.js, we need to handle worker creation differently
      // We'll use a dynamic import approach or create worker from URL
      // Since workers can't use ES modules directly in some browsers,
      // we'll use a blob URL with the worker code
      this.createWorker();
    } catch (error) {
      console.error('Failed to create evolution worker:', error);
      this.worker = null;
    }
  }

  /**
   * Creates the worker instance
   */
  private createWorker(): void {
    try {
      // Try to use the worker file directly if supported
      // For Next.js, we'll use a blob URL approach that includes the worker logic
      const workerUrl = this.getWorkerUrl();
      this.worker = new Worker(workerUrl, { type: 'module' });
      this.setupMessageHandler();
    } catch (error) {
      // Fallback: create inline worker
      console.warn('Direct worker file not available, using inline worker');
      this.createInlineWorker();
    }
  }

  /**
   * Gets the worker URL - tries to use the actual worker file
   */
  private getWorkerUrl(): string {
    // In Next.js, we need to handle this differently
    // For now, we'll use a relative path that should work
    // The bundler should handle this
    try {
      // Try to use import.meta.url if available (ES modules)
      if (typeof window !== 'undefined' && 'import.meta' in window) {
        return new URL('./evolution.worker.ts', import.meta.url).href;
      }
    } catch {
      // Fall through to inline worker
    }
    throw new Error('Worker URL not available');
  }

  /**
   * Creates an inline worker as fallback
   */
  private createInlineWorker(): void {
    // Import the worker logic and create a blob worker
    // We'll need to inline the worker code here
    const workerCode = `
      // Worker-compatible creature type
      const workerTournamentSelection = (creatures, tournamentSize = 3) => {
        if (creatures.length === 0) {
          throw new Error('Cannot select from empty creature array');
        }
        const tournament = [];
        for (let i = 0; i < tournamentSize; i++) {
          const randomIndex = Math.floor(Math.random() * creatures.length);
          tournament.push(creatures[randomIndex]);
        }
        return tournament.reduce((best, current) =>
          current.fitness.total > best.fitness.total ? current : best
        );
      };

      const selectElitesAndParents = (creatures, elitismCount, topPercent) => {
        if (creatures.length === 0) {
          return { elites: [], parents: [] };
        }
        const sorted = [...creatures].sort(
          (a, b) => b.fitness.total - a.fitness.total
        );
        const elites = sorted.slice(0, Math.min(elitismCount, sorted.length));
        const topCount = Math.max(1, Math.floor(sorted.length * topPercent));
        const parents = sorted.slice(0, topCount);
        return { elites, parents };
      };

      // Arithmetic crossover
      const arithmeticCrossover = (parent1, parent2, alpha = 0.5) => {
        if (parent1.genes.length !== parent2.genes.length) {
          throw new Error('Parent genomes must have the same number of genes');
        }
        const clampedAlpha = Math.max(0, Math.min(1, alpha));
        const genes = parent1.genes.map((gene1, index) => {
          const gene2 = parent2.genes[index];
          if (!gene2) return gene1;
          return {
            muscleId: gene1.muscleId,
            amplitude: gene1.amplitude * clampedAlpha + gene2.amplitude * (1 - clampedAlpha),
            frequency: gene1.frequency * clampedAlpha + gene2.frequency * (1 - clampedAlpha),
            phase: gene1.phase * clampedAlpha + gene2.phase * (1 - clampedAlpha),
          };
        });
        return {
          id: \`genome-\${Date.now()}-\${Math.random().toString(36).substr(2, 9)}\`,
          genes,
          generation: Math.max(parent1.generation, parent2.generation) + 1,
          parentIds: [parent1.id, parent2.id],
          createdAt: Date.now(),
        };
      };

      // Mutation
      const mutateGenome = (genome, mutationRate, mutationStrength) => {
        const mutateValue = (value, min, max) => {
          const change = (Math.random() - 0.5) * 2 * mutationStrength;
          const newValue = value * (1 + change);
          return Math.max(min, Math.min(max, newValue));
        };
        const genes = genome.genes.map((gene) => {
          if (Math.random() > mutationRate) {
            return gene;
          }
          return {
            ...gene,
            amplitude: mutateValue(gene.amplitude, 0.05, 0.8),
            frequency: mutateValue(gene.frequency, 0.1, 5.0),
            phase: mutateValue(gene.phase, 0, Math.PI * 2),
          };
        });
        return { ...genome, genes };
      };

      const evolveGeneration = (input) => {
        const { creatures, config } = input;
        const {
          elitismCount,
          parentsTopPercent,
          mutationRate,
          mutationStrength,
          populationSize,
          currentGeneration,
        } = config;

        const { elites, parents } = selectElitesAndParents(
          creatures,
          elitismCount,
          parentsTopPercent
        );

        const nextGenomes = elites.map((c) => c.genome);

        while (nextGenomes.length < populationSize) {
          const p1 = workerTournamentSelection(parents, 3);
          const p2 = workerTournamentSelection(parents, 3);
          let offspring = arithmeticCrossover(p1.genome, p2.genome);
          offspring = mutateGenome(offspring, mutationRate, mutationStrength);
          offspring = { ...offspring, generation: currentGeneration + 1 };
          nextGenomes.push(offspring);
        }

        return { genomes: nextGenomes };
      };

      self.onmessage = (event) => {
        try {
          const input = event.data;
          const output = evolveGeneration(input);
          self.postMessage(output);
        } catch (error) {
          self.postMessage({
            error: error instanceof Error ? error.message : 'Unknown error occurred',
          });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    this.setupMessageHandler();
  }

  /**
   * Sets up message handler for worker responses
   */
  private setupMessageHandler(): void {
    if (!this.worker) return;

    this.worker.onmessage = (event: MessageEvent<EvolutionOutput>) => {
      const output = event.data;

      if (output.error) {
        // Handle error - reject pending promise
        if (this.pendingReject) {
          this.pendingReject(new Error(output.error));
          this.pendingResolve = null;
          this.pendingReject = null;
        }
        return;
      }

      // Resolve pending promise
      if (this.pendingResolve) {
        this.pendingResolve(output);
        this.pendingResolve = null;
        this.pendingReject = null;
      }
    };

    this.worker.onerror = (error) => {
      console.error('Evolution worker error:', error);
      // Reject pending promise
      if (this.pendingReject) {
        this.pendingReject(new Error('Worker error occurred'));
        this.pendingResolve = null;
        this.pendingReject = null;
      }
    };
  }

  /**
   * Evolves a generation of creatures
   * @param input Evolution input with creatures and config
   * @returns Promise resolving to evolved genomes
   */
  async evolve(input: EvolutionInput): Promise<EvolutionOutput> {
    if (!this.worker) {
      throw new Error('Worker not available. Evolution worker failed to initialize.');
    }

    // Reject any pending operation
    if (this.pendingReject) {
      this.pendingReject(new Error('New evolution request started before previous completed'));
    }

    return new Promise<EvolutionOutput>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      try {
        this.worker!.postMessage(input);
      } catch (error) {
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(
          error instanceof Error
            ? error
            : new Error('Failed to send message to worker')
        );
      }
    });
  }

  /**
   * Terminates the worker and cleans up resources
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.pendingReject) {
      this.pendingReject(new Error('Worker terminated'));
      this.pendingResolve = null;
      this.pendingReject = null;
    }
  }

  /**
   * Checks if the worker is available
   */
  isAvailable(): boolean {
    return this.worker !== null;
  }
}
