import axios, { AxiosError } from "axios";

type GenerateJsonInput = {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
};

export class OllamaConfigurationError extends Error {}
export class OllamaUnavailableError extends Error {}
export class OllamaInvalidJsonError extends Error {}

function getOllamaConfig() {
  const apiKey = process.env.OLLAMA_API_KEY;
  const baseUrl = process.env.OLLAMA_BASE_URL || "https://ollama.com";
  const model = process.env.OLLAMA_MODEL;

  if (!apiKey) {
    throw new OllamaConfigurationError("Ollama Cloud API key is not configured.");
  }

  if (!model) {
    throw new OllamaConfigurationError("Ollama Cloud model is not configured.");
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
  };
}

function extractJsonFromResponse(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(value.slice(start, end + 1));
    }
    throw new OllamaInvalidJsonError("Ollama Cloud returned invalid JSON.");
  }
}

async function callOllamaCloud(prompt: string) {
  const { apiKey, baseUrl, model } = getOllamaConfig();

  try {
    const { data } = await axios.post(
      `${baseUrl}/api/generate`,
      {
        model,
        prompt,
        stream: false,
        format: "json",
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 90000,
      }
    );

    return data?.response ?? data;
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.response || axiosError.request) {
      throw new OllamaUnavailableError("Ollama Cloud is unreachable.");
    }
    throw error;
  }
}

export async function generateJsonWithOllamaCloud({
  systemPrompt,
  userPrompt,
  schemaName,
}: GenerateJsonInput) {
  const prompt = [
    systemPrompt,
    "",
    `Required schema: ${schemaName}.`,
    "Return strict JSON only. No markdown. No explanation.",
    "",
    userPrompt,
  ].join("\n");

  const strictRetryPrompt = [
    systemPrompt,
    "",
    `Required schema: ${schemaName}.`,
    "Return only valid JSON. No markdown. No explanation. Match the required schema exactly.",
    "",
    userPrompt,
  ].join("\n");

  try {
    return extractJsonFromResponse(await callOllamaCloud(prompt));
  } catch (error) {
    if (!(error instanceof OllamaInvalidJsonError) && !(error instanceof SyntaxError)) {
      throw error;
    }
  }

  try {
    return extractJsonFromResponse(await callOllamaCloud(strictRetryPrompt));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new OllamaInvalidJsonError("Ollama Cloud returned invalid JSON.");
    }
    throw error;
  }
}
