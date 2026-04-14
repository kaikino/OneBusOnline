import OnebusawaySDK from "onebusaway-sdk";

export function createObaClient(): OnebusawaySDK {
  const apiKey = process.env.ONEBUSAWAY_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ONEBUSAWAY_API_KEY");
  }
  const baseURL =
    process.env.OBA_BASE_URL?.trim() ||
    process.env.ONEBUSAWAY_SDK_BASE_URL?.trim();
  return new OnebusawaySDK({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    maxRetries: 2,
    timeout: 25_000,
  });
}

export function isObaConfigured(): boolean {
  return Boolean(process.env.ONEBUSAWAY_API_KEY?.trim());
}
