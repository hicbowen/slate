ALTER TABLE `contents`
  ADD COLUMN `image_gray_etag` VARCHAR(64) NULL,
  ADD COLUMN `image_gray_size` INTEGER NULL,
  ADD COLUMN `display_mode` VARCHAR(16) NOT NULL DEFAULT 'mono1';
