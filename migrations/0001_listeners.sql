-- Listener presence rows. `hash` is the HMAC-SHA256 of the client's random listener ID; the raw ID is never
-- stored. `expires_at_ms` gives every row a TTL: readers filter on it and the hourly cron deletes expired rows.
-- There is deliberately no index on expires_at_ms: D1 bills index maintenance as an extra written row on every
-- upsert, which would nearly double daily write usage. Table scans stay cheap at this size (thousands of rows).
CREATE TABLE IF NOT EXISTS listeners (
  hash         TEXT PRIMARY KEY,
  platform     TEXT NOT NULL DEFAULT '',
  country      TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  latitude     REAL,
  longitude    REAL,
  last_beat_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
) WITHOUT ROWID;
