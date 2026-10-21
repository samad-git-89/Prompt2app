-- Prompt2app chat prompt tracking. Chat content is intentionally not readable
-- through the public Data API; assistant responses are rendered in the client.
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 4000)
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_messages FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.chat_messages TO anon;

DROP POLICY IF EXISTS chat_messages_anon_insert ON public.chat_messages;
CREATE POLICY chat_messages_anon_insert ON public.chat_messages
  FOR INSERT TO anon
  WITH CHECK (char_length(btrim(content)) BETWEEN 1 AND 4000);
