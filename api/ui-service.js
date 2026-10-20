function isValidSupabaseUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;

  try {
    const url = new URL(value.trim());
    const isLocalHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || isLocalHttp)
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function firstConfiguredValue(primary, fallback, isValid) {
  if (isValid(primary)) return primary.trim();
  if (isValid(fallback)) return fallback.trim();
  return undefined;
}

export default async function handler(req, res) {
  const supabaseUrl = firstConfiguredValue(
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL_LIVE,
    isValidSupabaseUrl,
  );
  const supabaseAnonKey = firstConfiguredValue(
    process.env.SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_LIVE,
    (value) => typeof value === 'string' && value.trim().length > 0,
  );

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase URL or anon key is missing or invalid in the environment.');
    return res.status(500).json({ error: 'Supabase configuration missing or invalid.' });
  }

  return res.status(200).json({
    supabaseConfig: {
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
    },
  });
}