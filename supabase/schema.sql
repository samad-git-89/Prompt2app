-- Prompt2app Core Database Schema
create table if not exists public.chat_messages (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    message text not null,
    response text,
    sender_role text default 'user'::text
);

-- Enable Row-Level Security
alter table public.chat_messages enable row level security;

-- Enable public anonymous insert-only access
create policy "Allow anon insert access" on public.chat_messages 
    for insert to anon with check (char_length(message) <= 4000);

-- Enable public anonymous select access for live rendering
create policy "Allow anon select access" on public.chat_messages 
    for select to anon using (true);
