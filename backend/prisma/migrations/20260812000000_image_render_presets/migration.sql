ALTER TABLE `contents`
  ADD COLUMN `image_source_etag` VARCHAR(64) NULL,
  ADD COLUMN `image_source_size` INTEGER NULL,
  ADD COLUMN `image_render_preset` VARCHAR(16) NOT NULL DEFAULT 'auto';
