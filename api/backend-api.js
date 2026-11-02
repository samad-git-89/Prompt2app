import {
  isConversationalGreeting,
  runConversationalTurn,
  runPipeline,
} from '../functions/index.js';

export default async function handler(req, res) {
  let customApiKey;
  try {
    if (req.method === 'GET') {
      res.status(200).json({
        managedAvailable: Boolean(process.env.GEMINI_API_KEY),
        checkoutUrls: {
          starter: process.env.CHECKOUT_URL_STARTER || null,
          pro: process.env.CHECKOUT_URL_PRO || null,
        },
      });
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).json({ error: `Method ${req.method} Not Allowed` });
      return;
    }

    const message = req.body?.message;
    if (typeof message !== 'string' || message.trim().length === 0 || message.length > 4000) {
      res.status(400).json({ error: 'Message must contain between 1 and 4000 characters.' });
      return;
    }

    const trimmedMessage = message.trim();
    const keyHeader = trimmedMessage.match(/^\[BYO_KEY:([^\]\r\n]{1,256})\]\n/);
    if (trimmedMessage.startsWith('[BYO_KEY:') && !keyHeader) {
      res.status(400).json({ error: 'The supplied API key header is invalid.' });
      return;
    }
    if (keyHeader) {
      customApiKey = keyHeader[1];
      if (customApiKey.trim() !== customApiKey || /\s/.test(customApiKey)) {
        res.status(400).json({ error: 'The supplied API key header is invalid.' });
        return;
      }
    }
    const prompt = keyHeader ? trimmedMessage.slice(keyHeader[0].length).trim() : trimmedMessage;
    if (!prompt) {
      res.status(400).json({ error: 'Message must contain between 1 and 4000 characters.' });
      return;
    }

    if (isConversationalGreeting(prompt)) {
      const greetingResponse = await runConversationalTurn({
        prompt,
        ...(customApiKey ? { apiKey: customApiKey } : {}),
      });
      res.status(200).json({
        response: greetingResponse,
        files: [],
        isConversational: true,
      });
      return;
    }

    const result = await runPipeline({
      prompt,
      ...(customApiKey ? { apiKey: customApiKey } : {}),
    });
    if (!result.validation.valid) {
      throw new Error(`Generated files failed validation: ${result.validation.errors.join('; ')}`);
    }

    res.status(200).json({
      response: `Generated ${result.files.length} validated files for ${result.spec.name}. Save them to a folder or download them below.`,
      files: result.files,
      spec: result.spec,
    });
  } catch (error) {
    if (customApiKey) {
      console.error('Backend AI request failed while using a user-supplied key.');
    } else {
      console.error('Backend AI request failed:', error);
    }
    res.status(500).json({ error: 'App generation failed. Please try again.' });
  }
}
