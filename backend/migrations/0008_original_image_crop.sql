ALTER TABLE contents
    ADD COLUMN image_original_hash char(64),
    ADD COLUMN image_crop jsonb,
    ADD CONSTRAINT contents_image_original_crop_check CHECK (
        (image_original_hash IS NULL AND image_crop IS NULL)
        OR (kind = 'image' AND image_original_hash IS NOT NULL AND image_crop IS NOT NULL)
    );
