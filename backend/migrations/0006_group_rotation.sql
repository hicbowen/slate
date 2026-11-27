ALTER TABLE groups ADD COLUMN rotation_minutes SMALLINT NOT NULL DEFAULT 0
    CHECK (rotation_minutes IN (0, 15, 30, 60));
