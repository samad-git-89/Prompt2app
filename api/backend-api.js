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
                'Speak in clear, natural, plain-text sentences. Guide the user conversationally, ask at most one concise question at a time only when an essential product requirement is missing, and infer sensible defaults for nonessential details.',
                'Do not require keywords such as “proceed”, “build”, or “start”. Once the core app purpose and layout are clear, stop asking nonessential questions and prepare the request for the platform generation flow without waiting for a confirmation phrase.',
                'Do not show code blocks, raw JSON, YAML, AppSpec schemas, or internal technical metadata. Keep any planning or structured blueprint internal and explain outcomes in approachable language.',
                'Never output terminal commands, shell scripts, local CLI instructions, or ask the user to run npm, node, or other commands to generate an app.',
                'If a platform generation or deployment tool is not available in this request, be transparent about that limitation without redirecting the user to local commands.',
                'Do not claim that code generation, a build, a file write, or deployment has started or completed unless the platform generation and delivery tools were actually invoked and reported success.',
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