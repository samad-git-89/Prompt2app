create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  content text not null
    check (char_length(btrim(content)) between 1 and 4000),
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

revoke all on table public.chat_messages from public, anon, authenticated;
grant usage on schema public to anon;
grant insert on table public.chat_messages to anon;

drop policy if exists chat_messages_anon_insert on public.chat_messages;
create policy chat_messages_anon_insert
  on public.chat_messages
  for insert
  to anon
  with check (char_length(btrim(content)) between 1 and 4000);
