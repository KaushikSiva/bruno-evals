-- Apply in the Supabase SQL editor. Runtime access stays on the Node server.
begin;
create table if not exists public.bruno_runs (
  kind text not null check (kind in ('job','live')),
  id uuid not null,
  task text not null,
  status text not null,
  verdict text,
  created_at timestamptz not null,
  source_updated_at timestamptz not null,
  archived_at timestamptz not null default now(),
  document jsonb not null,
  assets jsonb not null default '[]'::jsonb,
  primary key (kind,id),
  check (jsonb_typeof(document) = 'object'),
  check (jsonb_typeof(assets) = 'array')
);
create index if not exists bruno_runs_created on public.bruno_runs (created_at desc);
alter table public.bruno_runs enable row level security;
revoke all on public.bruno_runs from anon, authenticated;
grant select, insert, update on public.bruno_runs to service_role;

-- Refuse to replace a newer archived snapshot with an older offline import.
create or replace function public.bruno_archive_run(payload jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into public.bruno_runs(kind,id,task,status,verdict,created_at,source_updated_at,document,assets)
  values (payload->>'kind',(payload->>'id')::uuid,payload->>'task',payload->>'status',
    payload->>'verdict',(payload->>'created_at')::timestamptz,
    (payload->>'source_updated_at')::timestamptz,payload->'document',payload->'assets')
  on conflict (kind,id) do update set task=excluded.task,status=excluded.status,
    verdict=excluded.verdict,source_updated_at=excluded.source_updated_at,
    document=excluded.document,assets=excluded.assets,archived_at=now()
  where public.bruno_runs.source_updated_at <= excluded.source_updated_at;
$$;
revoke all on function public.bruno_archive_run(jsonb) from public, anon, authenticated;
grant execute on function public.bruno_archive_run(jsonb) to service_role;

-- Deliberately add no anonymous/public Storage policy. Existing buckets are
-- left untouched; the application refuses to use a public bucket.
insert into storage.buckets(id,name,public)
values ('bruno-evidence','bruno-evidence',false)
on conflict (id) do nothing;
commit;
