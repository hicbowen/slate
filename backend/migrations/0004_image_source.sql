ALTER TABLE contents
    ADD COLUMN image_source_hash char(64),
    ADD COLUMN image_render_preset text NOT NULL DEFAULT 'auto',
    ADD CONSTRAINT contents_image_render_preset_check CHECK (image_render_preset IN ('auto', 'photo', 'vivid', 'graphic')),
    ADD CONSTRAINT contents_image_source_kind_check CHECK (image_source_hash IS NULL OR kind = 'image');
