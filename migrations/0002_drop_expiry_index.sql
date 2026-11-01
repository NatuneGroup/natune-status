-- 0001 originally created idx_listeners_expires before the index was removed from the schema (D1 bills
-- index maintenance as an extra written row per upsert). Drop it on databases that applied the old
-- version; on fresh databases this is a harmless no-op.
DROP INDEX IF EXISTS idx_listeners_expires;
