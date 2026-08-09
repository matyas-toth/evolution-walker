export const TRAINING_FRAME_RATE = 60
export const TRAINING_GROUND_Y = 600
export const TRAINING_SPAWN_X = 100
export const TRAINING_SPAWN_Y = 570
export const TRAINING_TARGET_WIDTH = 100
export const TRAINING_TARGET_HEIGHT = 80

export interface TrainingTargetZone {
    x: number
    y: number
    width: number
    height: number
}

/** Returns the target geometry shared by training, detection, and victory replay. */
export function getTrainingTargetZone(targetDistance: number): TrainingTargetZone {
    return {
        x: targetDistance,
        y: TRAINING_GROUND_Y - 100,
        width: TRAINING_TARGET_WIDTH,
        height: TRAINING_TARGET_HEIGHT,
    }
}
