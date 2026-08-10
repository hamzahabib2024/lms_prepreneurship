import { Module } from "@nestjs/common";
import { ContentService } from "./content.service";
import { ContentController } from "./content.controller";
import { LessonResourceService } from "./lesson-resource.service";
import { LessonResourceController } from "./lesson-resource.controller";
import { StorageRegistry } from "./storage/storage.registry";
import { LocalStorageProvider } from "./storage/local.storage";
import { GoogleDriveStorageProvider } from "./storage/google-drive.storage";

/**
 * Adding a storage provider touches this file and one adapter beside it —
 * the same containment the LCAL gives conferencing (ARC-043, ARC-028).
 */
@Module({
  controllers: [ContentController, LessonResourceController],
  providers: [
    ContentService,
    StorageRegistry,
    LocalStorageProvider,
    GoogleDriveStorageProvider,
    LessonResourceService,
  ],
  exports: [ContentService, StorageRegistry],
})
export class ContentModule {}
