-- TopoForge — Supabase database setup
-- Paste this entire file into: Supabase Dashboard → SQL Editor → Run

-- ─────────────────────────────────────────
-- Table 1: uploads
-- Tracks every map file uploaded
-- ─────────────────────────────────────────
create table if not exists uploads (
  id           bigserial primary key,
  file_id      text not null unique,      -- 8-char UUID prefix (e.g. "a3f2b1c0")
  filename     text not null,             -- original file name user uploaded
  file_type    text not null,             -- "geotiff", "jpg", "png", etc.
  has_bounds   boolean default false,     -- true if lat/lon bounds were detected
  bounds_json  jsonb,                     -- {"north":22.5,"south":21.5,...} or null
  created_at   timestamptz default now(),
  view_count   integer default 0
);

-- ─────────────────────────────────────────
-- Table 2: voice_sessions
-- Tracks AI voice tour sessions
-- ─────────────────────────────────────────
create table if not exists voice_sessions (
  id               bigserial primary key,
  file_id          text not null,
  duration_seconds integer default 0,    -- how long the voice chat lasted
  created_at       timestamptz default now()
);

-- ─────────────────────────────────────────
-- Function: increment_view_count
-- Called by the backend when stylize is triggered
-- ─────────────────────────────────────────
create or replace function increment_view_count(p_file_id text)
returns void as $$
  update uploads set view_count = view_count + 1 where file_id = p_file_id;
$$ language sql;

-- ─────────────────────────────────────────
-- Row Level Security (keep data public-read for the app)
-- ─────────────────────────────────────────
alter table uploads enable row level security;
alter table voice_sessions enable row level security;

-- Allow the backend (anon key) to read and insert
create policy "allow_read" on uploads for select using (true);
create policy "allow_insert" on uploads for insert with check (true);
create policy "allow_update" on uploads for update using (true);

create policy "allow_read" on voice_sessions for select using (true);
create policy "allow_insert" on voice_sessions for insert with check (true);
