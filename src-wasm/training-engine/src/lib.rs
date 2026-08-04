use std::mem;
use std::slice;

const DT: f32 = 1.0 / 60.0;
const GRAVITY: f32 = 200.0;
const AIR_DAMPING: f32 = 0.98;
const GROUND_FRICTION: f32 = 0.7;
const GROUND_RESTITUTION: f32 = 0.3;
const TWO_PI: f32 = std::f32::consts::PI * 2.0;

#[derive(Clone, Copy)]
struct ParticleDef {
    x: f32,
    y: f32,
    mass: f32,
    radius: f32,
    locked: bool,
}

#[derive(Clone, Copy)]
struct ConstraintDef {
    p1: usize,
    p2: usize,
    length: f32,
    stiffness: f32,
    muscle: i32,
}

struct Engine {
    population: usize,
    particle_count: usize,
    muscle_count: usize,
    total_generation_steps: usize,
    generation: u32,
    current_step: usize,
    mutation_rate: f32,
    mutation_strength: f32,
    elitism: usize,
    parent_percent: f32,
    target_distance: f32,
    ground_y: f32,
    spawn_x: f32,
    spawn_y: f32,
    rng: u32,
    head_index: usize,
    particles: Vec<ParticleDef>,
    constraints: Vec<ConstraintDef>,
    genomes: Vec<f32>,
    x: Vec<f32>,
    y: Vec<f32>,
    old_x: Vec<f32>,
    old_y: Vec<f32>,
    alive: Vec<u8>,
    reached: Vec<u8>,
    center_x: Vec<f32>,
    center_y: Vec<f32>,
    max_distance: Vec<f32>,
    min_head_y: Vec<f32>,
    fitness: Vec<f32>,
    oscillator_sin: Vec<f32>,
    oscillator_cos: Vec<f32>,
    oscillator_step_sin: Vec<f32>,
    oscillator_step_cos: Vec<f32>,
    best_ever_fitness: f32,
    best_ever_genome: Vec<f32>,
    last_best_genome: Vec<f32>,
    last_target_genome: Vec<f32>,
    summary: [f32; 8],
}

impl Engine {
    fn from_input(input: &[f32]) -> Option<Self> {
        if input.len() < 14 {
            return None;
        }
        let population = input[0] as usize;
        let particle_count = input[1] as usize;
        let constraint_count = input[2] as usize;
        let muscle_count = input[3] as usize;
        if population == 0 || particle_count == 0 {
            return None;
        }
        let mut cursor = 14;
        let mut particles = Vec::with_capacity(particle_count);
        let mut head_index = 0;
        for index in 0..particle_count {
            if cursor + 6 > input.len() {
                return None;
            }
            particles.push(ParticleDef {
                x: input[cursor],
                y: input[cursor + 1],
                mass: input[cursor + 2].max(0.0001),
                radius: input[cursor + 3],
                locked: input[cursor + 4] != 0.0,
            });
            if input[cursor + 5] != 0.0 {
                head_index = index;
            }
            cursor += 6;
        }
        let mut constraints = Vec::with_capacity(constraint_count);
        for _ in 0..constraint_count {
            if cursor + 5 > input.len() {
                return None;
            }
            constraints.push(ConstraintDef {
                p1: input[cursor] as usize,
                p2: input[cursor + 1] as usize,
                length: input[cursor + 2],
                stiffness: input[cursor + 3],
                muscle: input[cursor + 4] as i32,
            });
            cursor += 5;
        }
        let genome_len = population * muscle_count * 3;
        if cursor + genome_len > input.len() {
            return None;
        }
        let genomes = input[cursor..cursor + genome_len].to_vec();
        let particle_len = population * particle_count;
        let oscillator_len = population * muscle_count;
        let genome_stride = muscle_count * 3;
        let mut engine = Self {
            population,
            particle_count,
            muscle_count,
            total_generation_steps: input[4].max(1.0) as usize,
            generation: input[5].max(1.0) as u32,
            current_step: 0,
            mutation_rate: input[7],
            mutation_strength: input[8],
            elitism: input[9].max(0.0) as usize,
            parent_percent: input[10],
            target_distance: input[11],
            ground_y: input[12],
            spawn_x: 100.0,
            spawn_y: input[13],
            rng: input[6] as u32 | 1,
            head_index,
            particles,
            constraints,
            genomes,
            x: vec![0.0; particle_len],
            y: vec![0.0; particle_len],
            old_x: vec![0.0; particle_len],
            old_y: vec![0.0; particle_len],
            alive: vec![1; population],
            reached: vec![0; population],
            center_x: vec![0.0; population],
            center_y: vec![0.0; population],
            max_distance: vec![0.0; population],
            min_head_y: vec![0.0; population],
            fitness: vec![0.0; population],
            oscillator_sin: vec![0.0; oscillator_len],
            oscillator_cos: vec![0.0; oscillator_len],
            oscillator_step_sin: vec![0.0; oscillator_len],
            oscillator_step_cos: vec![0.0; oscillator_len],
            best_ever_fitness: f32::NEG_INFINITY,
            best_ever_genome: vec![0.0; genome_stride],
            last_best_genome: vec![0.0; genome_stride],
            last_target_genome: Vec::new(),
            summary: [0.0; 8],
        };
        engine.reset_population();
        Some(engine)
    }

    fn random(&mut self) -> f32 {
        let mut value = self.rng;
        value ^= value << 13;
        value ^= value >> 17;
        value ^= value << 5;
        self.rng = value;
        value as f32 / u32::MAX as f32
    }

    fn reset_population(&mut self) {
        for creature in 0..self.population {
            let particle_base = creature * self.particle_count;
            let mut total_mass = 0.0;
            let mut weighted_x = 0.0;
            let mut weighted_y = 0.0;
            self.alive[creature] = 1;
            self.reached[creature] = 0;
            for particle in 0..self.particle_count {
                let index = particle_base + particle;
                let x = self.spawn_x + self.particles[particle].x;
                let y = self.spawn_y + self.particles[particle].y;
                self.x[index] = x;
                self.y[index] = y;
                self.old_x[index] = x;
                self.old_y[index] = y;
                let mass = self.particles[particle].mass;
                total_mass += mass;
                weighted_x += x * mass;
                weighted_y += y * mass;
            }
            self.center_x[creature] = weighted_x / total_mass;
            self.center_y[creature] = weighted_y / total_mass;
            self.max_distance[creature] = self.center_x[creature];
            self.min_head_y[creature] = self.y[particle_base + self.head_index];
            for muscle in 0..self.muscle_count {
                let oscillator = creature * self.muscle_count + muscle;
                let genome = oscillator * 3;
                let phase = self.genomes[genome + 2];
                let delta = TWO_PI * self.genomes[genome + 1] * DT;
                self.oscillator_sin[oscillator] = phase.sin();
                self.oscillator_cos[oscillator] = phase.cos();
                self.oscillator_step_sin[oscillator] = delta.sin();
                self.oscillator_step_cos[oscillator] = delta.cos();
            }
        }
    }

    fn run_steps(&mut self, maximum: usize) -> bool {
        let end = (self.current_step + maximum.max(1)).min(self.total_generation_steps);
        while self.current_step < end {
            self.step();
            self.current_step += 1;
        }
        self.current_step >= self.total_generation_steps
    }

    fn step(&mut self) {
        let dt_squared = DT * DT;
        for creature in 0..self.population {
            if self.alive[creature] == 0 {
                continue;
            }
            let particle_base = creature * self.particle_count;
            let muscle_base = creature * self.muscle_count;
            for particle in 0..self.particle_count {
                if self.particles[particle].locked {
                    continue;
                }
                let index = particle_base + particle;
                let pos_x = self.x[index];
                let pos_y = self.y[index];
                let velocity_x = (pos_x - self.old_x[index]) * AIR_DAMPING;
                let velocity_y = (pos_y - self.old_y[index]) * AIR_DAMPING;
                self.old_x[index] = pos_x;
                self.old_y[index] = pos_y;
                self.x[index] = pos_x + velocity_x;
                self.y[index] = pos_y + velocity_y + (GRAVITY / self.particles[particle].mass) * dt_squared;
            }
            for _ in 0..3 {
                for constraint in &self.constraints {
                    let p1_index = particle_base + constraint.p1;
                    let p2_index = particle_base + constraint.p2;
                    let dx = self.x[p2_index] - self.x[p1_index];
                    let dy = self.y[p2_index] - self.y[p1_index];
                    let distance = (dx * dx + dy * dy).sqrt();
                    if distance == 0.0 {
                        continue;
                    }
                    let target = if constraint.muscle >= 0 {
                        let muscle = constraint.muscle as usize;
                        constraint.length
                            * (1.0 + self.genomes[(muscle_base + muscle) * 3] * self.oscillator_sin[muscle_base + muscle])
                    } else {
                        constraint.length
                    };
                    let difference = distance - target;
                    if difference.abs() < 0.01 {
                        continue;
                    }
                    let scale = difference * constraint.stiffness / distance;
                    let correction_x = dx * scale;
                    let correction_y = dy * scale;
                    let total_mass = self.particles[constraint.p1].mass + self.particles[constraint.p2].mass;
                    let p1_ratio = self.particles[constraint.p2].mass / total_mass;
                    let p2_ratio = self.particles[constraint.p1].mass / total_mass;
                    if !self.particles[constraint.p1].locked {
                        self.x[p1_index] += correction_x * p1_ratio;
                        self.y[p1_index] += correction_y * p1_ratio;
                    }
                    if !self.particles[constraint.p2].locked {
                        self.x[p2_index] -= correction_x * p2_ratio;
                        self.y[p2_index] -= correction_y * p2_ratio;
                    }
                }
            }
            let mut total_mass = 0.0;
            let mut weighted_x = 0.0;
            let mut weighted_y = 0.0;
            for particle in 0..self.particle_count {
                let index = particle_base + particle;
                let radius = self.particles[particle].radius;
                let maximum_y = self.ground_y - radius;
                if self.y[index] > maximum_y {
                    let velocity_x = self.x[index] - self.old_x[index];
                    let velocity_y = self.y[index] - self.old_y[index];
                    self.y[index] = maximum_y;
                    self.old_y[index] = maximum_y + velocity_y * GROUND_RESTITUTION;
                    self.old_x[index] = self.x[index] - velocity_x * GROUND_FRICTION;
                }
                if self.x[index] < radius {
                    self.x[index] = radius;
                    self.old_x[index] = radius;
                }
                let mass = self.particles[particle].mass;
                total_mass += mass;
                weighted_x += self.x[index] * mass;
                weighted_y += self.y[index] * mass;
                if self.reached[creature] == 0
                    && self.x[index] >= self.target_distance
                    && self.x[index] <= self.target_distance + 100.0
                    && self.y[index] >= self.ground_y - 100.0
                    && self.y[index] <= self.ground_y - 20.0
                {
                    self.reached[creature] = 1;
                }
            }
            let head_y = self.y[particle_base + self.head_index];
            if head_y >= self.ground_y - self.particles[self.head_index].radius {
                self.alive[creature] = 0;
            } else {
                self.min_head_y[creature] = self.min_head_y[creature].min(head_y);
                self.center_x[creature] = weighted_x / total_mass;
                self.center_y[creature] = weighted_y / total_mass;
                self.max_distance[creature] = self.max_distance[creature].max(self.center_x[creature]);
            }
            for muscle in 0..self.muscle_count {
                let index = muscle_base + muscle;
                let sin = self.oscillator_sin[index];
                let cos = self.oscillator_cos[index];
                let delta_sin = self.oscillator_step_sin[index];
                let delta_cos = self.oscillator_step_cos[index];
                self.oscillator_sin[index] = sin * delta_cos + cos * delta_sin;
                self.oscillator_cos[index] = cos * delta_cos - sin * delta_sin;
                if self.current_step & 255 == 255 {
                    let magnitude = (self.oscillator_sin[index] * self.oscillator_sin[index]
                        + self.oscillator_cos[index] * self.oscillator_cos[index])
                        .sqrt()
                        .max(0.00001);
                    self.oscillator_sin[index] /= magnitude;
                    self.oscillator_cos[index] /= magnitude;
                }
            }
        }
    }

    fn finish_generation(&mut self) {
        let mut best_fitness = f32::NEG_INFINITY;
        let mut total_fitness = 0.0;
        let mut best_index = 0usize;
        let mut target_index = -1i32;
        for creature in 0..self.population {
            let distance = self.max_distance[creature] - self.spawn_x;
            let target_center = self.target_distance + 50.0;
            let target_range = (self.target_distance - self.spawn_x).abs().max(1.0);
            let target_bonus = if self.reached[creature] != 0 {
                1000.0
            } else {
                (1.0 - (self.center_x[creature] - target_center).abs() / target_range).max(0.0) * 500.0
            };
            let upright = 50.0 * ((self.ground_y - self.min_head_y[creature]) / self.ground_y).max(0.0);
            let death = if self.alive[creature] == 0 { -500.0 } else { 0.0 };
            let fitness = distance + target_bonus + upright + death;
            self.fitness[creature] = fitness;
            total_fitness += fitness;
            if fitness > best_fitness {
                best_fitness = fitness;
                best_index = creature;
            }
            if target_index < 0 && self.reached[creature] != 0 {
                target_index = creature as i32;
            }
        }
        let stride = self.muscle_count * 3;
        self.last_best_genome.copy_from_slice(&self.genomes[best_index * stride..(best_index + 1) * stride]);
        self.last_target_genome.clear();
        if target_index >= 0 {
            let target = target_index as usize;
            self.last_target_genome.extend_from_slice(&self.genomes[target * stride..(target + 1) * stride]);
        }
        if best_fitness > self.best_ever_fitness {
            self.best_ever_fitness = best_fitness;
            self.best_ever_genome.copy_from_slice(&self.last_best_genome);
        }
        self.summary = [
            self.generation as f32,
            best_fitness,
            total_fitness / self.population as f32,
            best_index as f32,
            target_index as f32,
            self.best_ever_fitness,
            100.0,
            self.current_step as f32,
        ];
        self.evolve();
        self.generation += 1;
        self.current_step = 0;
        self.reset_population();
    }

    fn tournament(&mut self, ranked: &[usize], parent_count: usize) -> usize {
        let mut best = ranked[(self.random() * parent_count as f32) as usize % parent_count];
        for _ in 1..3 {
            let candidate = ranked[(self.random() * parent_count as f32) as usize % parent_count];
            if self.fitness[candidate] > self.fitness[best] {
                best = candidate;
            }
        }
        best
    }

    fn evolve(&mut self) {
        let mut ranked: Vec<usize> = (0..self.population).collect();
        ranked.sort_unstable_by(|left, right| self.fitness[*right].total_cmp(&self.fitness[*left]));
        let parent_count = ((self.population as f32 * self.parent_percent) as usize).clamp(1, self.population);
        let stride = self.muscle_count * 3;
        let mut next = vec![0.0; self.genomes.len()];
        for child in 0..self.population {
            if child < self.elitism.min(self.population) {
                let source = ranked[child];
                next[child * stride..(child + 1) * stride]
                    .copy_from_slice(&self.genomes[source * stride..(source + 1) * stride]);
                continue;
            }
            let parent1 = self.tournament(&ranked, parent_count);
            let parent2 = self.tournament(&ranked, parent_count);
            let bias = if self.fitness[parent1] >= self.fitness[parent2] { 0.6 } else { 0.4 };
            for value in 0..stride {
                let source = if self.random() < bias { parent1 } else { parent2 };
                let mut result = self.genomes[source * stride + value];
                if self.random() <= self.mutation_rate {
                    result *= 1.0 + (self.random() - 0.5) * 2.0 * self.mutation_strength;
                    result = match value % 3 {
                        0 => result.clamp(0.05, 0.8),
                        1 => result.clamp(0.1, 5.0),
                        _ => result.clamp(0.0, TWO_PI),
                    };
                }
                next[child * stride + value] = result;
            }
        }
        self.genomes = next;
    }
}

static mut ENGINE: *mut Engine = std::ptr::null_mut();

fn engine_mut() -> Option<&'static mut Engine> {
    unsafe { ENGINE.as_mut() }
}

#[no_mangle]
pub extern "C" fn training_alloc_f32(length: usize) -> *mut f32 {
    let mut values = Vec::<f32>::with_capacity(length);
    let pointer = values.as_mut_ptr();
    mem::forget(values);
    pointer
}

#[no_mangle]
pub extern "C" fn training_dealloc_f32(pointer: *mut f32, length: usize) {
    if pointer.is_null() || length == 0 {
        return;
    }
    unsafe { drop(Vec::from_raw_parts(pointer, 0, length)) };
}

#[no_mangle]
pub extern "C" fn training_init(pointer: *const f32, length: usize) -> i32 {
    if pointer.is_null() || length == 0 {
        return 0;
    }
    let input = unsafe { slice::from_raw_parts(pointer, length) };
    let Some(engine) = Engine::from_input(input) else {
        return 0;
    };
    unsafe {
        if !ENGINE.is_null() {
            drop(Box::from_raw(ENGINE));
        }
        ENGINE = Box::into_raw(Box::new(engine));
    }
    1
}

#[no_mangle]
pub extern "C" fn training_run_steps(maximum: usize) -> i32 {
    engine_mut().map_or(0, |engine| engine.run_steps(maximum) as i32)
}

#[no_mangle]
pub extern "C" fn training_finish_generation() {
    if let Some(engine) = engine_mut() {
        engine.finish_generation();
    }
}

#[no_mangle]
pub extern "C" fn training_generation() -> u32 {
    engine_mut().map_or(0, |engine| engine.generation)
}

#[no_mangle]
pub extern "C" fn training_progress() -> f32 {
    engine_mut().map_or(0.0, |engine| engine.current_step as f32 / engine.total_generation_steps as f32 * 100.0)
}

#[no_mangle]
pub extern "C" fn training_update_config(
    mutation_rate: f32,
    mutation_strength: f32,
    elitism: usize,
    parent_percent: f32,
    target_distance: f32,
) {
    if let Some(engine) = engine_mut() {
        engine.mutation_rate = mutation_rate;
        engine.mutation_strength = mutation_strength;
        engine.elitism = elitism;
        engine.parent_percent = parent_percent;
        engine.target_distance = target_distance;
    }
}

macro_rules! export_slice {
    ($pointer_name:ident, $length_name:ident, $field:ident) => {
        #[no_mangle]
        pub extern "C" fn $pointer_name() -> *const f32 {
            engine_mut().map_or(std::ptr::null(), |engine| engine.$field.as_ptr())
        }
        #[no_mangle]
        pub extern "C" fn $length_name() -> usize {
            engine_mut().map_or(0, |engine| engine.$field.len())
        }
    };
}

export_slice!(training_genomes_ptr, training_genomes_len, genomes);
export_slice!(training_x_ptr, training_x_len, x);
export_slice!(training_y_ptr, training_y_len, y);
export_slice!(training_center_x_ptr, training_center_x_len, center_x);
export_slice!(training_center_y_ptr, training_center_y_len, center_y);
export_slice!(training_last_best_ptr, training_last_best_len, last_best_genome);
export_slice!(training_last_target_ptr, training_last_target_len, last_target_genome);
export_slice!(training_best_ever_ptr, training_best_ever_len, best_ever_genome);

#[no_mangle]
pub extern "C" fn training_summary_ptr() -> *const f32 {
    engine_mut().map_or(std::ptr::null(), |engine| engine.summary.as_ptr())
}

#[no_mangle]
pub extern "C" fn training_summary_len() -> usize {
    8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_input(population: usize, steps: usize, seed: u32) -> Vec<f32> {
        let mut input = vec![
            population as f32, 2.0, 1.0, 1.0, steps as f32, 1.0, seed as f32,
            0.2, 0.4, 1.0, 0.5, 1400.0, 600.0, 570.0,
            0.0, -20.0, 1.0, 5.0, 0.0, 1.0,
            20.0, 0.0, 1.0, 5.0, 0.0, 0.0,
            0.0, 1.0, 20.0, 0.9, 0.0,
        ];
        for creature in 0..population {
            input.extend_from_slice(&[0.2 + creature as f32 * 0.01, 1.0, 0.0]);
        }
        input
    }

    fn test_engine(population: usize, steps: usize, seed: u32) -> Engine {
        Engine::from_input(&test_input(population, steps, seed)).expect("valid test engine")
    }

    #[test]
    fn xorshift_never_stalls_for_nonzero_seed() {
        let mut engine = Engine::from_input(&[
            1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 42.0, 0.1, 0.2, 1.0, 1.0, 100.0, 600.0, 570.0,
            0.0, 0.0, 1.0, 1.0, 0.0, 1.0,
        ]).expect("valid minimal engine");
        assert_ne!(engine.random(), engine.random());
    }

    #[test]
    fn seeded_random_streams_are_reproducible() {
        let mut first = test_engine(4, 3, 12345);
        let mut second = test_engine(4, 3, 12345);
        for _ in 0..32 {
            assert_eq!(first.random(), second.random());
        }
    }

    #[test]
    fn reset_initializes_persistent_population_slabs() {
        let engine = test_engine(8, 3, 7);
        assert_eq!(engine.x.len(), 16);
        assert_eq!(engine.genomes.len(), 24);
        assert!(engine.alive.iter().all(|alive| *alive == 1));
        assert_eq!(engine.x[0], 100.0);
        assert_eq!(engine.y[0], 550.0);
    }

    #[test]
    fn simulation_completes_exact_bounded_step_count() {
        let mut engine = test_engine(3, 5, 9);
        assert!(!engine.run_steps(2));
        assert_eq!(engine.current_step, 2);
        assert!(engine.run_steps(10));
        assert_eq!(engine.current_step, 5);
    }

    #[test]
    fn evolution_preserves_population_and_gene_bounds() {
        let mut engine = test_engine(16, 1, 11);
        engine.mutation_rate = 1.0;
        engine.mutation_strength = 4.0;
        for (index, fitness) in engine.fitness.iter_mut().enumerate() {
            *fitness = index as f32;
        }
        engine.evolve();
        assert_eq!(engine.genomes.len(), 16 * 3);
        for gene in engine.genomes.chunks_exact(3) {
            assert!((0.05..=0.8).contains(&gene[0]));
            assert!((0.1..=5.0).contains(&gene[1]));
            assert!((0.0..=TWO_PI).contains(&gene[2]));
        }
    }

    #[test]
    fn target_detection_is_reported_before_population_reset() {
        let mut engine = test_engine(4, 1, 13);
        engine.reached[2] = 1;
        engine.finish_generation();
        assert_eq!(engine.summary[4], 2.0);
        assert_eq!(engine.last_target_genome.len(), 3);
        assert_eq!(engine.generation, 2);
        assert_eq!(engine.current_step, 0);
    }

    #[test]
    fn finished_generation_has_finite_fitness_and_keeps_elite() {
        let mut engine = test_engine(8, 2, 17);
        engine.run_steps(2);
        engine.finish_generation();
        assert!(engine.summary[1].is_finite());
        assert!(engine.summary[2].is_finite());
        assert_eq!(engine.best_ever_genome.len(), 3);
        assert_eq!(&engine.genomes[0..3], &engine.last_best_genome);
    }
}
