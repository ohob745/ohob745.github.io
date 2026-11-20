-- Naafi3 — tester registration schema and queries (PostgreSQL 14+).
--
-- The static dashboard (naffi3/admin.html) never talks to the database: it
-- calls the API at https://naafi3-api.onrender.com/api/v1. This file documents
-- the contract that API must satisfy so js/admin.js keeps working: column
-- names, status values, search/filter/pagination semantics.
--
-- Apply with:  psql "$DATABASE_URL" -f sql/testers.sql
--
-- Assumed table name: tester_registrations. Rename here and in the API model
-- together if the backend already uses another name.

BEGIN;

-- Status values used verbatim by the UI (naffi3/js/admin.js STATUS_LABELS).
CREATE TYPE tester_status AS ENUM (
  'pending',    -- بانتظار المراجعة
  'invited',    -- أُرسلت الدعوة
  'joined',     -- انضم إلى الاختبار
  'completed',  -- أكمل الاختبار
  'withdrawn'   -- انسحب
);

CREATE TABLE tester_registrations (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email             text          NOT NULL,
  tester_name       text,
  status            tester_status NOT NULL DEFAULT 'pending',
  notes             text,                    -- admin-only, never shown to testers
  consent_at        timestamptz   NOT NULL DEFAULT now(),
  registration_date timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT tester_registrations_email_len
    CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT tester_registrations_email_shape
    CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT tester_registrations_name_len
    CHECK (tester_name IS NULL OR char_length(tester_name) BETWEEN 1 AND 120),
  CONSTRAINT tester_registrations_notes_len
    CHECK (notes IS NULL OR char_length(notes) <= 2000)
);

-- One registration per address regardless of letter case.
CREATE UNIQUE INDEX tester_registrations_email_key
  ON tester_registrations (lower(email));

-- Serves the status filter and the default newest-first ordering.
CREATE INDEX tester_registrations_status_date_idx
  ON tester_registrations (status, registration_date DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tester_registrations_touch
  BEFORE UPDATE ON tester_registrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;


-- ---------------------------------------------------------------------------
-- Public registration (POST /testers/register)
-- Idempotent: re-registering an existing address is not an error and does not
-- overwrite an admin's status change.
-- ---------------------------------------------------------------------------
INSERT INTO tester_registrations (email, tester_name, consent_at)
VALUES (lower($1), NULLIF($2, ''), now())
ON CONFLICT (lower(email)) DO NOTHING
RETURNING id, email, tester_name, status, registration_date;


-- ---------------------------------------------------------------------------
-- Admin list (GET /admin/testers?limit=&offset=&q=&status=)
-- $1 q (nullable), $2 status (nullable), $3 limit, $4 offset
-- ---------------------------------------------------------------------------
SELECT id, email, tester_name, status, notes, registration_date
FROM tester_registrations
WHERE ($1::text IS NULL
       OR email ILIKE '%' || $1 || '%'
       OR tester_name ILIKE '%' || $1 || '%')
  AND ($2::tester_status IS NULL OR status = $2)
ORDER BY registration_date DESC, id DESC
LIMIT $3 OFFSET $4;

-- total for the pager; run with the same $1/$2 predicate
SELECT count(*) AS total
FROM tester_registrations
WHERE ($1::text IS NULL
       OR email ILIKE '%' || $1 || '%'
       OR tester_name ILIKE '%' || $1 || '%')
  AND ($2::tester_status IS NULL OR status = $2);


-- ---------------------------------------------------------------------------
-- Stats cards (GET /admin/testers/stats)
-- ---------------------------------------------------------------------------
SELECT
  count(*)                                        AS total,
  count(*) FILTER (WHERE status = 'pending')      AS pending,
  count(*) FILTER (WHERE status = 'invited')      AS invited,
  count(*) FILTER (WHERE status = 'joined')       AS joined,
  count(*) FILTER (WHERE status = 'completed')    AS completed,
  count(*) FILTER (WHERE status = 'withdrawn')    AS withdrawn
FROM tester_registrations;


-- ---------------------------------------------------------------------------
-- Edit (PATCH /admin/testers/{id})
-- ---------------------------------------------------------------------------
UPDATE tester_registrations
SET status = $2::tester_status,
    notes  = NULLIF($3, '')
WHERE id = $1
RETURNING id, email, tester_name, status, notes, registration_date, updated_at;


-- ---------------------------------------------------------------------------
-- Delete (DELETE /admin/testers/{id})
-- ---------------------------------------------------------------------------
DELETE FROM tester_registrations
WHERE id = $1
RETURNING id, email;


-- ---------------------------------------------------------------------------
-- Exports
-- ---------------------------------------------------------------------------

-- Emails only (GET /admin/testers/export.csv), optional status filter in $1.
-- Copy-ready for Google Play Console.
SELECT email
FROM tester_registrations
WHERE ($1::tester_status IS NULL OR status = $1)
ORDER BY email;

-- Detailed (GET /admin/testers/export-detailed.csv), same optional $1.
SELECT email, tester_name, registration_date, status
FROM tester_registrations
WHERE ($1::tester_status IS NULL OR status = $1)
ORDER BY registration_date DESC, id DESC;
