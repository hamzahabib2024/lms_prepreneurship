import { Module } from "@nestjs/common";
import { ContentService } from "./content.service";
import { ContentController } from "./content.controller";
import { StorageRegistry } from "./storage/storage.registry";
import { LocalStorageProvider } from "./storage/local.storage";
import { GoogleDriveStorageProvider } from "./storage/google-drive.storage";

/**
 * Adding a storage provider touches this file and one adapter beside it —
 * the same containment the LCAL gives conferencing (ARC-043, ARC-028).
 */
@Module({
  controllers: [ContentController],
  providers: [
    ContentService,
    StorageRegistry,
    LocalStorageProvider,
    GoogleDriveStorageProvider,
  ],
  exports: [ContentService, StorageRegistry],
})
export class ContentModule {}
