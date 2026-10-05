-- OAuth-only accounts do not have a local password. Existing hashes are preserved.
ALTER TABLE `User` MODIFY `password` VARCHAR(191) NULL;
