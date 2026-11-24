ALTER TABLE contents
    ADD COLUMN gray_image_hash CHAR(64),
    ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'mono1',
    ADD CONSTRAINT contents_display_mode_check CHECK (
        display_mode = 'mono1' OR (display_mode = 'gray16' AND kind = 'image' AND gray_image_hash IS NOT NULL)
    );

CREATE INDEX contents_gray_image_hash_idx ON contents (gray_image_hash) WHERE gray_image_hash IS NOT NULL;
