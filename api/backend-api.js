export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  const message = req.body?.message;
  if (typeof message !== 'string' || message.trim().length === 0 || message.length > 4000) {
    res.status(400).json({ error: 'Message must contain between 1 and 4000 characters.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not configured for the backend.');
    res.status(500).json({ error: 'AI service is not configured.' });
    return;
  }

  try {
    const googleResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: message.trim() }] }],
          systemInstruction: {
            parts: [{ text: 'Act as an elite full-stack AppSpec engineer. Output structured layouts only.' }],
          },
          generationConfig: { maxOutputTokens: 1024 },
        }),
      },
    );

    if (!googleResponse.ok) {
      console.error(`Gemini API request failed with status ${googleResponse.status}.`);
      res.status(502).json({ error: 'AI service could not process the request.' });
      return;
    }

    const data = await googleResponse.json();
    const response = data.candidates?.[0]?.content?.parts
      ?.map(({ text }) => text)
      .filter((text) => typeof text === 'string')
      .join('');
    if (!response) {
      throw new Error('Gemini API response did not contain text.');
    }

    res.status(200).json({ response });
  } catch (error) {
    console.error('Gemini API request failed:', error);
    res.status(502).json({ error: 'AI service could not process the request.' });
  }
}