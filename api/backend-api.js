import { runPipeline } from '../functions/index.js';

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

    const result = await runPipeline({ prompt: message.trim() });
    if (!result.validation.valid) {
      throw new Error(`Generated files failed validation: ${result.validation.errors.join('; ')}`);
    }

    res.status(200).json({
      response: `Generated ${result.files.length} validated files for ${result.spec.name}. Save them to a folder or download them below.`,
      files: result.files,
    });
  } catch (error) {
    console.error('Backend AI request failed:', error);
    res.status(500).json({ error: 'App generation failed. Please try again.' });
  }
}
