-- CreateTable
CREATE TABLE `Genome` (
    `id` VARCHAR(191) NOT NULL,
    `creatureId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `weights` JSON NOT NULL,
    `fitness` DOUBLE NOT NULL,
    `reachedTarget` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Genome_creatureId_idx`(`creatureId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Genome` ADD CONSTRAINT `Genome_creatureId_fkey` FOREIGN KEY (`creatureId`) REFERENCES `Creature`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
