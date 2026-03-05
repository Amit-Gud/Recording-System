-- ── metadata schema ────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS metadata;

CREATE TABLE IF NOT EXISTS metadata.agents (
    id            SERIAL PRIMARY KEY,
    agent_id      VARCHAR(255) UNIQUE NOT NULL,
    hostname      VARCHAR(255),
    ip            VARCHAR(50),
    last_seen     TIMESTAMPTZ,
    registered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metadata.segments (
    id         SERIAL PRIMARY KEY,
    agent_id   VARCHAR(255) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time   TIMESTAMPTZ NOT NULL,
    file_path  VARCHAR(1024) NOT NULL,
    file_size  BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segments_agent_time
    ON metadata.segments (agent_id, start_time);

-- ── bookmarks schema ────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS bookmarks;

CREATE TABLE IF NOT EXISTS bookmarks.bookmarks (
    id         SERIAL PRIMARY KEY,
    agent_id   VARCHAR(255) NOT NULL,
    timestamp  TIMESTAMPTZ NOT NULL,
    label      VARCHAR(1024) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_agent_time
    ON bookmarks.bookmarks (agent_id, timestamp);
