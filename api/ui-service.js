// api/ui-service.js
// Vercel Serverless Function for UI-related data or configuration

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(500).json({
        message: 'SUPABASE_URL and SUPABASE_ANON_KEY must be configured in the environment.'
      });
    }

    // This service could provide dynamic UI configuration, such as text for components,
    // or other properties based on the application's state or user preferences.
    // Since AppSpec has no data models, this is a static placeholder.
    const uiConfig = {
      appName: 'Chat-Builder-Zoho UI Prototype',
      welcomeMessage: 'Welcome to the UI. This content could be dynamic!',
      buttonText: 'Click Me to Get Backend Message',
      textBlockContent: 'This text block content could be sourced from a dedicated UI service.'
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      message: 'Hello from ui-service.js!',
      uiConfig: uiConfig,
      supabaseConfig: { url: supabaseUrl, anonKey: supabaseAnonKey },
      timestamp: new Date().toISOString()
    });
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
