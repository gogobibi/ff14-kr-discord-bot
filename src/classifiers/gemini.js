import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { JSON_SCHEMA_BATCH } from './prompt.js';

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

let _model;
function getModel() {
  if (_model) return _model;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const genAI = new GoogleGenerativeAI(apiKey);
  _model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: JSON_SCHEMA_BATCH,
    },
  });
  return _model;
}

export async function callGemini(prompt) {
  const model = getModel();
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return JSON.parse(text);
}
