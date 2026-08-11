-- Device capability is reported by firmware; existing devices remain Note4 monochrome.
ALTER TABLE `devices`
  ADD COLUMN `display_profile` VARCHAR(32) NOT NULL DEFAULT 'note4_mono';

-- Keep legacy image_etag/image_size as the canonical mono1 rendition.
-- Existing rows stay NULL and are served through a lossless mono1 -> bwry2 fallback.
ALTER TABLE `contents`
  ADD COLUMN `image_bwry_etag` VARCHAR(64) NULL,
  ADD COLUMN `image_bwry_size` INTEGER NULL;
