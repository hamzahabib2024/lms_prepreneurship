import { Module } from "@nestjs/common";
import { ContentService } from "./content.service";
import { LectureSyncService } from "./lecture-sync.service";
import { ContentController } from "./content.controller";
import { MediaController } from "./media.controller";
import { LessonResourceService } from "./lesson-resource.service";
import { LessonResourceController } from "./lesson-resource.controller";
import { StorageRegistry } from "./storage/storage.registry";
import { LocalStorageProvider } from "./storage/local.storage";
import { GoogleDriveStorageProvider } from "./storage/google-drive.storage";
import { CourseMediaService } from "./course-media.service";
import { CourseMediaController } from "./course-media.controller";

/**
 * Adding a storage provider touches this file and one adapter beside it —
 * the same containment the LCAL gives conferencing (ARC-043, ARC-028).
 */
@Module({
  controllers: [ContentController, LessonResourceController, MediaController, CourseMediaController],
  providers: [
    ContentService,
    LectureSyncService,
    StorageRegistry,
    LocalStorageProvider,
    GoogleDriveStorageProvider,
    LessonResourceService,
    CourseMediaService,
  ],
  // CourseMediaService is exported because the academic module attaches a
  // picture to a programme or a subject, and the public prospectus turns an
  // asset id into the URL a browser asks for. One place knows that shape.
  exports: [ContentService, StorageRegistry, CourseMediaService],
})
export class ContentModule {}
