-- Run this in your Supabase SQL editor
-- Creates the partidos table with RLS disabled for simplicity (enable auth later)

create table if not exists partidos (
  id           text primary key,
  nombre       text not null,
  equipo_local text not null default '',
  equipo_visitante text not null default '',
  fecha        text not null default '',
  score        jsonb not null default '{"local":0,"visitante":0}',
  events       jsonb not null default '[]',
  players      jsonb not null default '[]',
  created_at   bigint not null default extract(epoch from now()) * 1000
);

-- Allow public read/write (add auth later)
alter table partidos enable row level security;
create policy "public_all" on partidos for all using (true) with check (true);
