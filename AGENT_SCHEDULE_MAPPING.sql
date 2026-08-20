create table if not exists public.agent_schedule_mappings (
  schedule_name text primary key,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_schedule_mappings enable row level security;

drop policy if exists "agent_schedule_mappings_select" on public.agent_schedule_mappings;
create policy "agent_schedule_mappings_select"
on public.agent_schedule_mappings for select
to anon, authenticated
using (true);

drop policy if exists "agent_schedule_mappings_insert" on public.agent_schedule_mappings;
create policy "agent_schedule_mappings_insert"
on public.agent_schedule_mappings for insert
to anon, authenticated
with check (true);

drop policy if exists "agent_schedule_mappings_update" on public.agent_schedule_mappings;
create policy "agent_schedule_mappings_update"
on public.agent_schedule_mappings for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "agent_schedule_mappings_delete" on public.agent_schedule_mappings;
create policy "agent_schedule_mappings_delete"
on public.agent_schedule_mappings for delete
to anon, authenticated
using (true);
