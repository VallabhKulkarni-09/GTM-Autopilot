-- Migration: 018_outcome_tracking.sql
-- Description: Outcome tracking — meeting detection via Salesforce Event polling.
--              Adds outcome_signal table (append-only, like event_log) and extends
--              play_instance with outcome columns. attribution_window_days is captured
--              at play creation time and never re-read from policy after that.
-- Rollback: see bottom of file

-- FORWARD MIGRATION

-- ── Extend policy_rule_type enum ──────────────────────────────────────────────
-- Must run before INSERT into policy_rules with rule_type = 'outcome_detection'.
-- IF NOT EXISTS is safe on re-run (idempotent).
ALTER TYPE policy_rule_type ADD VALUE IF NOT EXISTS 'outcome_detection';

-- ── outcome_signal table ──────────────────────────────────────────────────────
-- Append-only. Never UPDATE. Never DELETE. Mirrors event_log spirit.
-- sf_raw_payload stores the full raw Salesforce Event object for replay.
-- UNIQUE on (organization_id, play_instance_id, external_event_id) enforces
-- idempotency: re-polling the same SF Event never creates a duplicate row.

CREATE TABLE outcome_signal (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  play_instance_id UUID        NOT NULL REFERENCES play_instance(id) ON DELETE CASCADE,
  lead_id          UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  signal_type      TEXT        NOT NULL CHECK (signal_type IN (
                                 'sf_event_meeting',
                                 'lead_status',
                                 'meeting_checkbox',
                                 'opportunity_stage'
                               )),
  confidence       TEXT        NOT NULL CHECK (confidence IN ('primary', 'supportive')),
  external_event_id TEXT       NOT NULL,
  sf_raw_payload   JSONB       NOT NULL,    -- full raw SF payload for replay
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NO updated_at — this table is append-only
  CONSTRAINT uq_outcome_signal_org_play_event
    UNIQUE (organization_id, play_instance_id, external_event_id)
);

CREATE INDEX idx_outcome_signal_play_instance
  ON outcome_signal(play_instance_id);

CREATE INDEX idx_outcome_signal_org_detected
  ON outcome_signal(organization_id, detected_at);

CREATE INDEX idx_outcome_signal_org_lead
  ON outcome_signal(organization_id, lead_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE outcome_signal ENABLE ROW LEVEL SECURITY;

CREATE POLICY outcome_signal_tenant_isolation ON outcome_signal
  USING (organization_id = current_setting('app.current_org_id')::uuid);

-- ── play_instance outcome columns ─────────────────────────────────────────────
-- outcome_status:           tracks where this play stands on meeting detection
-- outcome_detected_at:      timestamp of first primary signal detection
-- attribution_window_days:  captured from policy at play start time — NEVER
--                           re-read from policy after play is created (see GEMINI.md)
-- late_meeting_flag:        primary signal arrived after the window closed
-- meetings_count_in_window: how many primary signals found within window

ALTER TABLE play_instance
  ADD COLUMN outcome_status           TEXT        NOT NULL DEFAULT 'no_outcome_yet'
    CHECK (outcome_status IN ('no_outcome_yet', 'meeting_booked', 'no_meeting')),
  ADD COLUMN outcome_detected_at      TIMESTAMPTZ,
  ADD COLUMN attribution_window_days  INT         NOT NULL DEFAULT 14,
  ADD COLUMN late_meeting_flag        BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN meetings_count_in_window INT         NOT NULL DEFAULT 0;

-- Index to speed up poller's primary query: plays awaiting outcome within window
CREATE INDEX idx_play_instance_outcome_status
  ON play_instance(organization_id, outcome_status)
  WHERE outcome_status = 'no_outcome_yet';

-- ROLLBACK
-- DROP INDEX IF EXISTS idx_play_instance_outcome_status;
-- ALTER TABLE play_instance
--   DROP COLUMN IF EXISTS meetings_count_in_window,
--   DROP COLUMN IF EXISTS late_meeting_flag,
--   DROP COLUMN IF EXISTS attribution_window_days,
--   DROP COLUMN IF EXISTS outcome_detected_at,
--   DROP COLUMN IF EXISTS outcome_status;
-- DROP POLICY IF EXISTS outcome_signal_tenant_isolation ON outcome_signal;
-- DROP INDEX IF EXISTS idx_outcome_signal_org_lead;
-- DROP INDEX IF EXISTS idx_outcome_signal_org_detected;
-- DROP INDEX IF EXISTS idx_outcome_signal_play_instance;
-- DROP TABLE IF EXISTS outcome_signal;
