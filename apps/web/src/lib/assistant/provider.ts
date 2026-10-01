import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";

export function getAppraiseLanguageModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const google = createGoogleGenerativeAI({ apiKey });
  return google(process.env.APPRAISE_MODEL ?? "gemini-3.6-flash");
}
