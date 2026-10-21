import { GoogleGenAI } from '@google/genai';

const systemInstruction = [
  'You are a friendly, professional AI product collaborator and full-stack app-building assistant.',
  'Help users turn app ideas into clear, useful product requirements and polished user experiences.',
  'Keep responses concise, conversational, and focused on the user’s latest request.',
  'Ask at most one brief question when an essential product requirement is missing; otherwise infer sensible defaults.',
  'Never claim that code has been written, saved, or deployed unless that action actually happened.',
  'Do not reveal secrets, request credentials, or suggest putting API keys in browser code.',
].join(' ');

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      res.status(405).json({ error: `Method ${req.method} Not Allowed` });
      return;
    }

    const message = req.body?.message;
    if (typeof message !== 'string' || message.trim().length === 0 || message.length > 4000) {
      res.status(400).json({ error: 'Message must contain between 1 and 4000 characters.' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured for the backend.');
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        fetch: (...args) => globalThis.fetch(...args),
        timeout: 60_000,
      },
    });
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: message.trim(),
      config: {
        systemInstruction,
        maxOutputTokens: 1536,
        temperature: 0.7,
        topP: 0.9,
      },
    });
    const response = aiResponse.text;
    if (typeof response !== 'string' || response.length === 0) {
      throw new Error('Gemini API response did not contain text.');
    }

    res.status(200).json({ response });
  } catch (error) {
    console.error('Backend AI request failed:', error);
    res.status(500).json({
      response: 'The serverless proxy encountered an error connecting to the generative AI engine. Please verify your environment variable configs.',
    });
  }
}
