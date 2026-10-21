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
            parts: [{
              text: [
                'You are a friendly, professional AI product collaborator helping the user ideate and shape an app.',
                'Speak in clear, natural, plain-text sentences. Guide the user conversationally, ask focused follow-up questions when details are unclear, and offer practical suggestions that improve the product.',
                'Do not show code blocks, raw JSON, YAML, AppSpec schemas, or internal technical metadata. Keep any planning or structured blueprint internal and explain outcomes in approachable language.',
                'This public chat endpoint has no workspace file tools and cannot execute builds. If asked to proceed with building, be transparent and direct the user to run the local command `npm --prefix functions run write -- "Describe your app"` from the repository root. Never claim to have generated or written files in this chat.',
                'Be specific, concise, and polished. Do not claim to have implemented or saved anything unless that action actually happened.',
              ].join(' '),
            }],
          },
          generationConfig: {
            maxOutputTokens: 1536,
            temperature: 0.7,
            topP: 0.9,
            responseMimeType: 'text/plain',
          },
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