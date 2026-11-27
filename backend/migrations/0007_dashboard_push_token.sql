ALTER TABLE content_dynamic ADD COLUMN push_token_hash TEXT
    CHECK (push_token_hash IS NULL OR push_token_hash = '' OR push_token_hash ~ '^[0-9a-f]{64}$');
