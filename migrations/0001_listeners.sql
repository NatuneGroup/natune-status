-- Listener presence rows. `hash` is the HMAC-SHA256 of the client's random listener ID; the raw ID is never
-- stored. `expires_at_ms` gives every row a TTL: readers filter on it and it is deleted by the sweep.
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

-- Both the expiry filter and the sweep DELETE use this index so reads stay bounded by live rows.
CREATE INDEX IF NOT EXISTS idx_listeners_expires ON listeners (expires_at_ms);
