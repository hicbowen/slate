ALTER TABLE contents ADD COLUMN color_image_hash CHAR(64);
CREATE INDEX contents_color_image_hash_idx ON contents (color_image_hash) WHERE color_image_hash IS NOT NULL;
