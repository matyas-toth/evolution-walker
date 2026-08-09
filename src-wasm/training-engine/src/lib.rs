use std::mem;
use std::slice;

const DT: f32 = 1.0 / 60.0;
const GRAVITY: f32 = 200.0;
const AIR_DAMPING: f32 = 0.98;
const GROUND_FRICTION: f32 = 0.7;
const GROUND_RESTITUTION: f32 = 0.3;
const TWO_PI: f32 = std::f32::consts::PI * 2.0;
const GENE_STRIDE: usize = 6;
const METRIC_STRIDE: usize = 16;
const ARCHIVE_CELLS: usize = 12 * 10 * 8;

#[derive(Clone, Copy)]
struct ParticleDef {
    x: f32,
    y: f32,
    mass: f32,
    radius: f32,
    locked: bool,
    core: bool,
    protected: bool,
    group: i32,
    branch_group: i32,
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
    group_count: usize,
    group_pairs: Vec<i32>,
    muscle_neighbors: Vec<Vec<usize>>,
    warmup_steps: usize,
    body_scale: f32,
    total_mass: f32,
    baseline_core_height: f32,
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
    metrics: Vec<f32>,
    pareto_order: Vec<usize>,
    stance_steps: Vec<u32>,
    strike_counts: Vec<u16>,
    interval_mean: Vec<f32>,
    interval_m2: Vec<f32>,
    last_strike_step: Vec<i32>,
    group_was_grounded: Vec<u8>,
    group_grounded: Vec<u8>,
    stance_slip: Vec<f32>,
    actuator_work: Vec<f32>,
    evaluated_steps: Vec<u32>,
    survival_steps: Vec<u32>,
    protected_clear_steps: Vec<u32>,
    core_height_sum: Vec<f32>,
    airborne_steps: Vec<u32>,
    paired_opposition: Vec<f32>,
    paired_samples: Vec<u32>,
    landing_impact_sq: Vec<f32>,
    landing_count: Vec<u32>,
    vertical_jerk_sq: Vec<f32>,
    previous_core_velocity: Vec<f32>,
    previous_core_y: Vec<f32>,
    sustained_progress: Vec<f32>,
    target_step: Vec<i32>,
    oscillator_sin: Vec<f32>,
    oscillator_cos: Vec<f32>,
    oscillator_step_sin: Vec<f32>,
    oscillator_step_cos: Vec<f32>,
    best_ever_fitness: f32,
    best_ever_genome: Vec<f32>,
    best_ever_metrics: Vec<f32>,
    last_best_genome: Vec<f32>,
    last_target_genome: Vec<f32>,
    last_best_metrics: Vec<f32>,
    last_target_metrics: Vec<f32>,
    archive_genomes: Vec<Option<Vec<f32>>>,
    archive_metric_cells: Vec<Option<[f32; METRIC_STRIDE]>>,
    archive_cells_export: Vec<f32>,
    archive_metrics_export: Vec<f32>,
    archive_genomes_export: Vec<f32>,
    curriculum_stage: u8,
    summary: [f32; 10],
}

impl Engine {
    fn from_input(input: &[f32]) -> Option<Self> {
        if input.len() < 17 {
            return None;
        }
        let population = input[0] as usize;
        let particle_count = input[1] as usize;
        let constraint_count = input[2] as usize;
        let muscle_count = input[3] as usize;
        if population == 0 || particle_count == 0 {
            return None;
        }
        let group_count = input[14].max(0.0) as usize;
        let warmup_steps = input[15].max(0.0) as usize;
        let initial_archive_count = input[16].max(0.0) as usize;
        let mut cursor = 17;
        let mut particles = Vec::with_capacity(particle_count);
        let mut head_index = 0;
        for index in 0..particle_count {
            if cursor + 10 > input.len() {
                return None;
            }
            particles.push(ParticleDef {
                x: input[cursor],
                y: input[cursor + 1],
                mass: input[cursor + 2].max(0.0001),
                radius: input[cursor + 3],
                locked: input[cursor + 4] != 0.0,
                core: input[cursor + 6] != 0.0,
                protected: input[cursor + 7] != 0.0,
                group: input[cursor + 8] as i32,
                branch_group: input[cursor + 9] as i32,
            });
            if input[cursor + 5] != 0.0 {
                head_index = index;
            }
            cursor += 10;
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
        if cursor + group_count > input.len() {
            return None;
        }
        let group_pairs = input[cursor..cursor + group_count].iter().map(|value| *value as i32).collect::<Vec<_>>();
        cursor += group_count;
        let genome_len = population * muscle_count * GENE_STRIDE;
        if cursor + genome_len > input.len() {
            return None;
        }
        let genomes = input[cursor..cursor + genome_len].to_vec();
        cursor += genome_len;
        let particle_len = population * particle_count;
        let oscillator_len = population * muscle_count;
        let genome_stride = muscle_count * GENE_STRIDE;
        let mut muscle_neighbors = vec![Vec::new(); muscle_count];
        let muscle_constraints = constraints.iter().filter(|constraint| constraint.muscle >= 0).collect::<Vec<_>>();
        for left in 0..muscle_constraints.len() {
            for right in left + 1..muscle_constraints.len() {
                let a = muscle_constraints[left];
                let b = muscle_constraints[right];
                if a.p1 == b.p1 || a.p1 == b.p2 || a.p2 == b.p1 || a.p2 == b.p2 {
                    let ai = a.muscle as usize;
                    let bi = b.muscle as usize;
                    muscle_neighbors[ai].push(bi);
                    muscle_neighbors[bi].push(ai);
                }
            }
        }
        let min_x = particles.iter().map(|particle| particle.x).fold(f32::INFINITY, f32::min);
        let max_x = particles.iter().map(|particle| particle.x).fold(f32::NEG_INFINITY, f32::max);
        let min_y = particles.iter().map(|particle| particle.y).fold(f32::INFINITY, f32::min);
        let max_y = particles.iter().map(|particle| particle.y).fold(f32::NEG_INFINITY, f32::max);
        let body_scale = (max_x - min_x).max(max_y - min_y).max(1.0);
        let total_mass = particles.iter().map(|particle| particle.mass).sum::<f32>().max(0.0001);
        let core_count = particles.iter().filter(|particle| particle.core).count().max(1);
        let core_y = particles.iter().filter(|particle| particle.core).map(|particle| particle.y).sum::<f32>() / core_count as f32;
        let baseline_core_height = (input[12] - (input[13] + core_y)).max(1.0);
        let group_len = population * group_count;
        let mut archive_genomes = (0..ARCHIVE_CELLS).map(|_| None).collect::<Vec<Option<Vec<f32>>>>();
        let mut archive_metric_cells = vec![None; ARCHIVE_CELLS];
        for _ in 0..initial_archive_count {
            if cursor + 1 + METRIC_STRIDE + genome_stride > input.len() { return None; }
            let cell = (input[cursor] as usize).min(ARCHIVE_CELLS - 1);
            cursor += 1;
            let mut metric = [0.0; METRIC_STRIDE];
            metric.copy_from_slice(&input[cursor..cursor + METRIC_STRIDE]);
            cursor += METRIC_STRIDE;
            archive_metric_cells[cell] = Some(metric);
            archive_genomes[cell] = Some(input[cursor..cursor + genome_stride].to_vec());
            cursor += genome_stride;
        }
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
            group_count,
            group_pairs,
            muscle_neighbors,
            warmup_steps,
            body_scale,
            total_mass,
            baseline_core_height,
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
            metrics: vec![0.0; population * METRIC_STRIDE],
            pareto_order: (0..population).collect(),
            stance_steps: vec![0; group_len],
            strike_counts: vec![0; group_len],
            interval_mean: vec![0.0; group_len],
            interval_m2: vec![0.0; group_len],
            last_strike_step: vec![-1; group_len],
            group_was_grounded: vec![0; group_len],
            group_grounded: vec![0; group_len],
            stance_slip: vec![0.0; population],
            actuator_work: vec![0.0; population],
            evaluated_steps: vec![0; population],
            survival_steps: vec![0; population],
            protected_clear_steps: vec![0; population],
            core_height_sum: vec![0.0; population],
            airborne_steps: vec![0; population],
            paired_opposition: vec![0.0; population],
            paired_samples: vec![0; population],
            landing_impact_sq: vec![0.0; population],
            landing_count: vec![0; population],
            vertical_jerk_sq: vec![0.0; population],
            previous_core_velocity: vec![0.0; population],
            previous_core_y: vec![0.0; population],
            sustained_progress: vec![0.0; population],
            target_step: vec![-1; population],
            oscillator_sin: vec![0.0; oscillator_len],
            oscillator_cos: vec![0.0; oscillator_len],
            oscillator_step_sin: vec![0.0; oscillator_len],
            oscillator_step_cos: vec![0.0; oscillator_len],
            best_ever_fitness: f32::NEG_INFINITY,
            best_ever_genome: vec![0.0; genome_stride],
            best_ever_metrics: vec![0.0; METRIC_STRIDE],
            last_best_genome: vec![0.0; genome_stride],
            last_target_genome: Vec::new(),
            last_best_metrics: vec![0.0; METRIC_STRIDE],
            last_target_metrics: Vec::new(),
            archive_genomes,
            archive_metric_cells,
            archive_cells_export: Vec::new(),
            archive_metrics_export: Vec::new(),
            archive_genomes_export: Vec::new(),
            curriculum_stage: 0,
            summary: [0.0; 10],
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
        self.stance_steps.fill(0);
        self.strike_counts.fill(0);
        self.interval_mean.fill(0.0);
        self.interval_m2.fill(0.0);
        self.last_strike_step.fill(-1);
        self.group_was_grounded.fill(0);
        self.group_grounded.fill(0);
        self.stance_slip.fill(0.0);
        self.actuator_work.fill(0.0);
        self.evaluated_steps.fill(0);
        self.survival_steps.fill(0);
        self.protected_clear_steps.fill(0);
        self.core_height_sum.fill(0.0);
        self.airborne_steps.fill(0);
        self.paired_opposition.fill(0.0);
        self.paired_samples.fill(0);
        self.landing_impact_sq.fill(0.0);
        self.landing_count.fill(0);
        self.vertical_jerk_sq.fill(0.0);
        self.previous_core_velocity.fill(0.0);
        self.sustained_progress.fill(0.0);
        self.target_step.fill(-1);
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
            self.previous_core_y[creature] = self.center_y[creature];
            for muscle in 0..self.muscle_count {
                let oscillator = creature * self.muscle_count + muscle;
                let genome = oscillator * GENE_STRIDE;
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
            if self.current_step >= self.warmup_steps {
                self.evaluated_steps[creature] += 1;
            }
            if self.alive[creature] == 0 {
                continue;
            }
            if self.current_step >= self.warmup_steps {
                self.survival_steps[creature] += 1;
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
            let posture_error = (self.baseline_core_height - (self.ground_y - self.center_y[creature])) / self.body_scale;
            for iteration in 0..3 {
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
                        let gene = (muscle_base + muscle) * GENE_STRIDE;
                        let group = if self.particles[constraint.p1].branch_group >= 0 {
                            self.particles[constraint.p1].branch_group
                        } else { self.particles[constraint.p2].branch_group };
                        let contact = if group >= 0 && self.group_was_grounded[creature * self.group_count + group as usize] != 0 { 1.0 } else { -0.25 };
                        let activation = self.oscillator_sin[muscle_base + muscle]
                            + self.genomes[gene + 4] * contact
                            + self.genomes[gene + 5] * posture_error.clamp(-1.0, 1.0);
                        let target = constraint.length * (1.0 + self.genomes[gene] * activation.clamp(-1.25, 1.25));
                        if iteration == 0 && self.current_step >= self.warmup_steps {
                            let sin = self.oscillator_sin[muscle_base + muscle];
                            let cos = self.oscillator_cos[muscle_base + muscle];
                            let previous_sin = sin * self.oscillator_step_cos[muscle_base + muscle]
                                - cos * self.oscillator_step_sin[muscle_base + muscle];
                            let command_change = (self.genomes[gene] * (sin - previous_sin) * constraint.length).abs();
                            self.actuator_work[creature] += (distance - target).abs() * constraint.stiffness * command_change;
                        }
                        target
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
            if self.group_count > 0 {
                self.group_grounded[creature * self.group_count..(creature + 1) * self.group_count].fill(0);
            }
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
                    let group = self.particles[particle].group;
                    if group >= 0 {
                        let group_index = creature * self.group_count + group as usize;
                        self.group_grounded[group_index] = 1;
                        if self.current_step >= self.warmup_steps {
                            self.stance_slip[creature] += velocity_x.abs();
                            if self.group_was_grounded[group_index] == 0 {
                                self.landing_impact_sq[creature] += velocity_y * velocity_y;
                                self.landing_count[creature] += 1;
                            }
                        }
                    }
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
                    if self.target_step[creature] < 0 { self.target_step[creature] = self.current_step as i32; }
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
            if self.current_step >= self.warmup_steps {
                let mut core_y = 0.0;
                let mut core_count = 0usize;
                let mut protected_clear = true;
                for particle in 0..self.particle_count {
                    let definition = self.particles[particle];
                    let index = particle_base + particle;
                    if definition.core { core_y += self.y[index]; core_count += 1; }
                    if definition.protected && self.y[index] + definition.radius >= self.ground_y - 0.5 { protected_clear = false; }
                }
                if core_count == 0 { core_y = self.center_y[creature]; core_count = 1; }
                core_y /= core_count as f32;
                let core_velocity = core_y - self.previous_core_y[creature];
                let jerk = core_velocity - self.previous_core_velocity[creature];
                self.previous_core_y[creature] = core_y;
                self.previous_core_velocity[creature] = core_velocity;
                self.vertical_jerk_sq[creature] += jerk * jerk;
                self.core_height_sum[creature] += (self.ground_y - core_y) / self.baseline_core_height;
                if protected_clear { self.protected_clear_steps[creature] += 1; }
                self.sustained_progress[creature] += ((self.center_x[creature] - self.spawn_x) / self.body_scale).max(0.0);

                let mut any_grounded = false;
                for group in 0..self.group_count {
                    let index = creature * self.group_count + group;
                    let grounded = self.group_grounded[index] != 0;
                    any_grounded |= grounded;
                    if grounded { self.stance_steps[index] += 1; }
                    if grounded && self.group_was_grounded[index] == 0 {
                        self.strike_counts[index] += 1;
                        if self.last_strike_step[index] >= 0 {
                            let interval = (self.current_step as i32 - self.last_strike_step[index]) as f32;
                            let sample = (self.strike_counts[index] - 1).max(1) as f32;
                            let delta = interval - self.interval_mean[index];
                            self.interval_mean[index] += delta / sample;
                            self.interval_m2[index] += delta * (interval - self.interval_mean[index]);
                        }
                        self.last_strike_step[index] = self.current_step as i32;
                    }
                    self.group_was_grounded[index] = grounded as u8;
                }
                if !any_grounded { self.airborne_steps[creature] += 1; }
                for group in 0..self.group_count {
                    let pair = self.group_pairs[group];
                    if pair < 0 || group >= pair as usize { continue; }
                    let left = self.group_grounded[creature * self.group_count + group] != 0;
                    let right = self.group_grounded[creature * self.group_count + pair as usize] != 0;
                    self.paired_opposition[creature] += if left != right { 1.0 } else if left && right { 0.25 } else { 0.0 };
                    self.paired_samples[creature] += 1;
                }
            }
            for muscle in 0..self.muscle_count {
                let index = muscle_base + muscle;
                let sin = self.oscillator_sin[index];
                let cos = self.oscillator_cos[index];
                let delta_sin = self.oscillator_step_sin[index];
                let delta_cos = self.oscillator_step_cos[index];
                let mut next_sin = sin * delta_cos + cos * delta_sin;
                let mut next_cos = cos * delta_cos - sin * delta_sin;
                let coupling = self.genomes[index * GENE_STRIDE + 3];
                if coupling != 0.0 && !self.muscle_neighbors[muscle].is_empty() {
                    let mut phase_error = 0.0;
                    for neighbor in &self.muscle_neighbors[muscle] {
                        let other = muscle_base + *neighbor;
                        phase_error += self.oscillator_sin[other] * next_cos - self.oscillator_cos[other] * next_sin;
                    }
                    let correction = (coupling * phase_error / self.muscle_neighbors[muscle].len() as f32 * DT).clamp(-0.2, 0.2);
                    let corrected_sin = next_sin + next_cos * correction;
                    next_cos -= next_sin * correction;
                    next_sin = corrected_sin;
                }
                self.oscillator_sin[index] = next_sin;
                self.oscillator_cos[index] = next_cos;
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

    fn calculate_metrics(&mut self) {
        for creature in 0..self.population {
            let evaluated = self.evaluated_steps[creature].max(1) as f32;
            let progress = (self.max_distance[creature] - self.spawn_x) / self.body_scale;
            let sustained = self.sustained_progress[creature] / evaluated;
            let group_base = creature * self.group_count;
            let total_stance = (0..self.group_count).map(|group| self.stance_steps[group_base + group] as f32).sum::<f32>();
            let utilization = if self.group_count <= 1 { 1.0 } else if total_stance <= 0.0 { 0.0 } else {
                let entropy = (0..self.group_count).fold(0.0, |sum, group| {
                    let share = self.stance_steps[group_base + group] as f32 / total_stance;
                    if share > 0.0 { sum - share * share.ln() } else { sum }
                });
                (entropy.exp() / self.group_count as f32).clamp(0.0, 1.0)
            };
            let mut periodicity_sum = 0.0;
            let mut periodic_groups = 0usize;
            for group in 0..self.group_count {
                let index = group_base + group;
                let intervals = self.strike_counts[index].saturating_sub(1) as usize;
                if intervals < 2 || self.interval_mean[index] <= 0.0 { continue; }
                let variance = self.interval_m2[index] / (intervals - 1).max(1) as f32;
                let coefficient = variance.max(0.0).sqrt() / self.interval_mean[index];
                periodicity_sum += (-coefficient * 2.0).exp();
                periodic_groups += 1;
            }
            let periodicity = if periodic_groups > 0 { periodicity_sum / periodic_groups as f32 } else { 0.0 };
            let traction = (-self.stance_slip[creature] / self.body_scale.max(progress.abs() * self.body_scale)).exp().clamp(0.0, 1.0);
            let core_ratio = (self.core_height_sum[creature] / evaluated).clamp(0.0, 1.5);
            let protected_clear = self.protected_clear_steps[creature] as f32 / evaluated;
            let carriage = (core_ratio.clamp(0.0, 1.0) * protected_clear.clamp(0.0, 1.0)).clamp(0.0, 1.0);
            let impact = (self.landing_impact_sq[creature] / self.landing_count[creature].max(1) as f32).sqrt()
                / (GRAVITY * self.body_scale).sqrt();
            let jerk = (self.vertical_jerk_sq[creature] / evaluated).sqrt() / self.body_scale;
            let smoothness = (-impact - jerk).exp().clamp(0.0, 1.0);
            let mut balance_sum = 0.0;
            let mut balance_count = 0usize;
            for group in 0..self.group_count {
                let pair = self.group_pairs[group];
                if pair < 0 || group >= pair as usize { continue; }
                let left = self.strike_counts[group_base + group] as f32;
                let right = self.strike_counts[group_base + pair as usize] as f32;
                balance_sum += left.min(right) / left.max(right).max(1.0);
                balance_count += 1;
            }
            let coordination = if self.paired_samples[creature] > 0 && balance_count > 0 {
                let opposition = (self.paired_opposition[creature] / self.paired_samples[creature] as f32).clamp(0.0, 1.0);
                (opposition * balance_sum / balance_count as f32).sqrt()
            } else { -1.0 };
            let mut product = utilization.max(0.001) * periodicity.max(0.001) * traction.max(0.001)
                * carriage.max(0.001) * smoothness.max(0.001);
            let components = if coordination >= 0.0 { product *= coordination.max(0.001); 6.0 } else { 5.0 };
            let quality = product.powf(1.0 / components) * 100.0;
            let distance = (progress.max(0.0) * self.body_scale).max(self.body_scale * 0.1);
            let transport_cost = self.actuator_work[creature] / (self.total_mass * GRAVITY * distance).max(0.0001);
            let energy_efficiency = 100.0 / (1.0 + transport_cost.max(0.0));
            let airborne = self.airborne_steps[creature] as f32 / evaluated;
            let survival = self.survival_steps[creature] as f32 / evaluated;
            let base = creature * METRIC_STRIDE;
            self.metrics[base..base + METRIC_STRIDE].copy_from_slice(&[
                progress, sustained, quality, utilization * 100.0, periodicity * 100.0,
                if coordination < 0.0 { -1.0 } else { coordination * 100.0 }, traction * 100.0,
                carriage * 100.0, smoothness * 100.0, energy_efficiency, transport_cost,
                airborne, survival, utilization, airborne, core_ratio.clamp(0.0, 1.0),
            ]);
        }
    }

    fn dominates(&self, left: usize, right: usize) -> bool {
        let a = &self.metrics[left * METRIC_STRIDE..(left + 1) * METRIC_STRIDE];
        let b = &self.metrics[right * METRIC_STRIDE..(right + 1) * METRIC_STRIDE];
        let av = (0.25 - a[12]).max(0.0) + if a.iter().all(|value| value.is_finite()) { 0.0 } else { 1.0 };
        let bv = (0.25 - b[12]).max(0.0) + if b.iter().all(|value| value.is_finite()) { 0.0 } else { 1.0 };
        if av != bv { return av < bv; }
        let objectives = [0usize, 2, 9, 12];
        objectives.iter().all(|index| a[*index] >= b[*index])
            && objectives.iter().any(|index| a[*index] > b[*index])
    }

    fn pareto_rank(&self) -> Vec<usize> {
        let mut dominated = vec![Vec::<usize>::new(); self.population];
        let mut dominators = vec![0usize; self.population];
        let mut fronts = vec![Vec::<usize>::new()];
        for left in 0..self.population {
            for right in 0..self.population {
                if left == right { continue; }
                if self.dominates(left, right) { dominated[left].push(right); }
                else if self.dominates(right, left) { dominators[left] += 1; }
            }
            if dominators[left] == 0 { fronts[0].push(left); }
        }
        let mut cursor = 0;
        while cursor < fronts.len() && !fronts[cursor].is_empty() {
            let mut next = Vec::new();
            for &left in &fronts[cursor] {
                for &right in &dominated[left] {
                    dominators[right] = dominators[right].saturating_sub(1);
                    if dominators[right] == 0 { next.push(right); }
                }
            }
            if !next.is_empty() { fronts.push(next); }
            cursor += 1;
        }
        let mut order = Vec::with_capacity(self.population);
        for mut front in fronts {
            if front.is_empty() { continue; }
            let mut crowding = vec![0.0f32; self.population];
            for objective in [0usize, 2, 9, 12] {
                front.sort_unstable_by(|left, right| self.metrics[left * METRIC_STRIDE + objective].total_cmp(&self.metrics[right * METRIC_STRIDE + objective]));
                crowding[front[0]] = f32::INFINITY;
                crowding[*front.last().unwrap()] = f32::INFINITY;
                let low = self.metrics[front[0] * METRIC_STRIDE + objective];
                let high = self.metrics[front[front.len() - 1] * METRIC_STRIDE + objective];
                if high > low && front.len() > 2 {
                    for index in 1..front.len() - 1 {
                        crowding[front[index]] += (self.metrics[front[index + 1] * METRIC_STRIDE + objective]
                            - self.metrics[front[index - 1] * METRIC_STRIDE + objective]) / (high - low);
                    }
                }
            }
            front.sort_unstable_by(|left, right| crowding[*right].total_cmp(&crowding[*left]));
            order.extend(front);
        }
        order
    }

    fn archive_cell(metric: &[f32]) -> usize {
        let x = (metric[13].clamp(0.0, 0.9999) * 12.0) as usize;
        let y = (metric[14].clamp(0.0, 0.9999) * 10.0) as usize;
        let z = (metric[15].clamp(0.0, 0.9999) * 8.0) as usize;
        (x * 10 + y) * 8 + z
    }

    fn update_archive(&mut self) {
        let stride = self.muscle_count * GENE_STRIDE;
        for creature in 0..self.population {
            let metric = &self.metrics[creature * METRIC_STRIDE..(creature + 1) * METRIC_STRIDE];
            let cell = Self::archive_cell(metric);
            let replace = self.archive_metric_cells[cell].as_ref().map_or(true, |current| {
                metric[0] > current[0] || (metric[0] == current[0] && metric[2] > current[2])
                    || (metric[0] == current[0] && metric[2] == current[2] && metric[10] < current[10])
            });
            if replace {
                let mut packed = [0.0; METRIC_STRIDE];
                packed.copy_from_slice(metric);
                self.archive_metric_cells[cell] = Some(packed);
                self.archive_genomes[cell] = Some(self.genomes[creature * stride..(creature + 1) * stride].to_vec());
            }
        }
        self.archive_cells_export.clear();
        self.archive_metrics_export.clear();
        self.archive_genomes_export.clear();
        for cell in 0..ARCHIVE_CELLS {
            if let (Some(metric), Some(genome)) = (&self.archive_metric_cells[cell], &self.archive_genomes[cell]) {
                self.archive_cells_export.push(cell as f32);
                self.archive_metrics_export.extend_from_slice(metric);
                self.archive_genomes_export.extend_from_slice(genome);
            }
        }
    }

    fn finish_generation(&mut self) {
        let mut best_fitness = f32::NEG_INFINITY;
        let mut total_fitness = 0.0;
        let mut reporting_best_index = 0usize;
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
                reporting_best_index = creature;
            }
        }
        self.calculate_metrics();
        self.pareto_order = self.pareto_rank();
        let best_index = self.pareto_order[0];
        for creature in 0..self.population {
            if self.reached[creature] == 0 { continue; }
            if target_index < 0 {
                target_index = creature as i32;
                continue;
            }
            let current = &self.metrics[creature * METRIC_STRIDE..(creature + 1) * METRIC_STRIDE];
            let winner = &self.metrics[target_index as usize * METRIC_STRIDE..(target_index as usize + 1) * METRIC_STRIDE];
            if current[2] > winner[2]
                || (current[2] == winner[2] && self.target_step[creature] < self.target_step[target_index as usize])
                || (current[2] == winner[2] && self.target_step[creature] == self.target_step[target_index as usize] && current[10] < winner[10]) {
                target_index = creature as i32;
            }
        }
        self.update_archive();
        let movers = (0..self.population).filter(|creature| self.metrics[creature * METRIC_STRIDE] >= 1.0 && self.metrics[creature * METRIC_STRIDE + 12] >= 0.5).count() as f32 / self.population as f32;
        let quality = (0..self.population).filter(|creature| self.metrics[creature * METRIC_STRIDE + 2] >= 60.0).count() as f32 / self.population as f32;
        self.curriculum_stage = if movers < 0.2 { 0 } else if quality >= 0.05 || self.archive_cells_export.len() as f32 / ARCHIVE_CELLS as f32 >= 0.1 { 2 } else { 1 };
        let stride = self.muscle_count * GENE_STRIDE;
        self.last_best_genome.copy_from_slice(&self.genomes[best_index * stride..(best_index + 1) * stride]);
        self.last_best_metrics.copy_from_slice(&self.metrics[best_index * METRIC_STRIDE..(best_index + 1) * METRIC_STRIDE]);
        self.last_target_genome.clear();
        self.last_target_metrics.clear();
        if target_index >= 0 {
            let target = target_index as usize;
            self.last_target_genome.extend_from_slice(&self.genomes[target * stride..(target + 1) * stride]);
            self.last_target_metrics.extend_from_slice(&self.metrics[target * METRIC_STRIDE..(target + 1) * METRIC_STRIDE]);
        }
        let best_is_better = self.best_ever_metrics.iter().all(|value| *value == 0.0)
            || self.last_best_metrics[0] > self.best_ever_metrics[0]
            || (self.last_best_metrics[0] == self.best_ever_metrics[0] && self.last_best_metrics[2] > self.best_ever_metrics[2]);
        self.best_ever_fitness = self.best_ever_fitness.max(best_fitness);
        if best_is_better {
            self.best_ever_genome.copy_from_slice(&self.last_best_genome);
            self.best_ever_metrics.copy_from_slice(&self.last_best_metrics);
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
            self.curriculum_stage as f32,
            reporting_best_index as f32,
        ];
        self.evolve();
        self.generation += 1;
        self.current_step = 0;
        self.reset_population();
    }

    fn tournament(&mut self, ranked: &[usize], parent_count: usize) -> usize {
        let mut best_position = (self.random() * parent_count as f32) as usize % parent_count;
        for _ in 1..3 {
            best_position = best_position.min((self.random() * parent_count as f32) as usize % parent_count);
        }
        ranked[best_position]
    }

    fn evolve(&mut self) {
        let ranked = self.pareto_order.clone();
        let parent_count = ((self.population as f32 * self.parent_percent) as usize).clamp(1, self.population);
        let stride = self.muscle_count * GENE_STRIDE;
        let mut next = vec![0.0; self.genomes.len()];
        for child in 0..self.population {
            if child < self.elitism.min(self.population) {
                let source = ranked[child];
                next[child * stride..(child + 1) * stride]
                    .copy_from_slice(&self.genomes[source * stride..(source + 1) * stride]);
                continue;
            }
            let random_weight = if self.curriculum_stage == 0 { 0.1 } else if self.curriculum_stage == 1 { 0.1 } else { 0.05 };
            let archive_weight = if self.curriculum_stage == 0 { 0.4 } else if self.curriculum_stage == 1 { 0.3 } else { 0.25 };
            if self.random() < random_weight {
                for muscle in 0..self.muscle_count {
                    let base = child * stride + muscle * GENE_STRIDE;
                    next[base] = self.random() * 0.5 + 0.1;
                    next[base + 1] = self.random() * 2.0 + 0.1;
                    next[base + 2] = self.random() * TWO_PI;
                    next[base + 3] = self.random() * 0.25;
                    next[base + 4] = (self.random() - 0.5) * 0.3;
                    next[base + 5] = (self.random() - 0.5) * 0.3;
                }
                continue;
            }
            let select_parent = |engine: &mut Self| -> Vec<f32> {
                if engine.random() < archive_weight && !engine.archive_cells_export.is_empty() {
                    let occupied = (engine.random() * engine.archive_cells_export.len() as f32) as usize % engine.archive_cells_export.len();
                    let cell = engine.archive_cells_export[occupied] as usize;
                    if let Some(genome) = &engine.archive_genomes[cell] { return genome.clone(); }
                }
                let parent = engine.tournament(&ranked, parent_count);
                engine.genomes[parent * stride..(parent + 1) * stride].to_vec()
            };
            let parent1 = select_parent(self);
            let parent2 = select_parent(self);
            for value in 0..stride {
                let mut result = if self.random() < 0.5 { parent1[value] } else { parent2[value] };
                if self.random() <= self.mutation_rate {
                    if value % GENE_STRIDE < 3 {
                        result *= 1.0 + (self.random() - 0.5) * 2.0 * self.mutation_strength;
                    } else {
                        result += (self.random() - 0.5) * self.mutation_strength * 0.5;
                    }
                    result = match value % GENE_STRIDE {
                        0 => result.clamp(0.05, 0.8),
                        1 => result.clamp(0.1, 5.0),
                        2 => result.rem_euclid(TWO_PI),
                        3 => result.clamp(0.0, 2.0),
                        _ => result.clamp(-2.0, 2.0),
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
export_slice!(training_last_best_metrics_ptr, training_last_best_metrics_len, last_best_metrics);
export_slice!(training_last_target_metrics_ptr, training_last_target_metrics_len, last_target_metrics);
export_slice!(training_archive_cells_ptr, training_archive_cells_len, archive_cells_export);
export_slice!(training_archive_metrics_ptr, training_archive_metrics_len, archive_metrics_export);
export_slice!(training_archive_genomes_ptr, training_archive_genomes_len, archive_genomes_export);

#[no_mangle]
pub extern "C" fn training_summary_ptr() -> *const f32 {
    engine_mut().map_or(std::ptr::null(), |engine| engine.summary.as_ptr())
}

#[no_mangle]
pub extern "C" fn training_summary_len() -> usize {
    10
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_input(population: usize, steps: usize, seed: u32) -> Vec<f32> {
        let mut input = vec![
            population as f32, 2.0, 1.0, 1.0, steps as f32, 1.0, seed as f32,
            0.2, 0.4, 1.0, 0.5, 1400.0, 600.0, 570.0,
            1.0, 0.0, 0.0,
            0.0, -20.0, 1.0, 5.0, 0.0, 1.0, 1.0, 1.0, -1.0, -1.0,
            20.0, 0.0, 1.0, 5.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 20.0, 0.9, 0.0,
            -1.0,
        ];
        for creature in 0..population {
            input.extend_from_slice(&[0.2 + creature as f32 * 0.01, 1.0, 0.0, 0.1, 0.0, 0.0]);
        }
        input
    }

    fn test_engine(population: usize, steps: usize, seed: u32) -> Engine {
        Engine::from_input(&test_input(population, steps, seed)).expect("valid test engine")
    }

    #[test]
    fn xorshift_never_stalls_for_nonzero_seed() {
        let mut engine = test_engine(1, 1, 42);
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
        assert_eq!(engine.genomes.len(), 48);
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
        assert_eq!(engine.genomes.len(), 16 * GENE_STRIDE);
        for gene in engine.genomes.chunks_exact(GENE_STRIDE) {
            assert!((0.05..=0.8).contains(&gene[0]));
            assert!((0.1..=5.0).contains(&gene[1]));
            assert!((0.0..=TWO_PI).contains(&gene[2]));
            assert!((0.0..=2.0).contains(&gene[3]));
            assert!((-2.0..=2.0).contains(&gene[4]));
            assert!((-2.0..=2.0).contains(&gene[5]));
        }
    }

    #[test]
    fn target_detection_is_reported_before_population_reset() {
        let mut engine = test_engine(4, 1, 13);
        engine.reached[2] = 1;
        engine.finish_generation();
        assert_eq!(engine.summary[4], 2.0);
        assert_eq!(engine.last_target_genome.len(), GENE_STRIDE);
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
        assert_eq!(engine.best_ever_genome.len(), GENE_STRIDE);
        assert_eq!(&engine.genomes[0..GENE_STRIDE], &engine.last_best_genome);
    }
}
