-- AlterTable
ALTER TABLE `TrainingSession`
    ADD COLUMN `archive` JSON NULL,
    ADD COLUMN `bestMetrics` JSON NULL;
