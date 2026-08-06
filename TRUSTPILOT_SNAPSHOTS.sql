create table if not exists public.trustpilot_snapshots (
  project text not null,
  snapshot_date date not null,
  trust_score numeric(4,2) not null default 0,
  star_rating numeric(4,2) not null default 0,
  total_reviews integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project, snapshot_date)
);

alter table public.trustpilot_snapshots enable row level security;

create policy "Trustpilot snapshots readable"
on public.trustpilot_snapshots for select
to anon, authenticated
using (true);

create policy "Trustpilot snapshots insertable"
on public.trustpilot_snapshots for insert
to anon, authenticated
with check (true);

create policy "Trustpilot snapshots updatable"
on public.trustpilot_snapshots for update
to anon, authenticated
using (true)
with check (true);
