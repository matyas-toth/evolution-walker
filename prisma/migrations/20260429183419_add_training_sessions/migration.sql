-- CreateTable
CREATE TABLE `TrainingSession` (
    `id` VARCHAR(191) NOT NULL,
    `creatureId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `config` JSON NOT NULL,
    `population` JSON NOT NULL,
    `bestGenome` JSON NOT NULL,
    `bestFitness` DOUBLE NOT NULL,
    `generation` INTEGER NOT NULL,
    `reachedTarget` BOOLEAN NOT NULL DEFAULT false,
    `targetDistance` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TrainingSession_creatureId_idx`(`creatureId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TrainingSession` ADD CONSTRAINT `TrainingSession_creatureId_fkey` FOREIGN KEY (`creatureId`) REFERENCES `Creature`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
