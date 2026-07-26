const LIVECHAT_ACCOUNT_ID = process.env.LIVECHAT_ACCOUNT_ID;
const LIVECHAT_PAT = process.env.LIVECHAT_PAT;

const MAX_RETRIES = 4;
const BASE_RETRY_DELAY_MS = 1200;

function getAuthHeader() {
  return `Basic ${Buffer.from(
    `${LIVECHAT_ACCOUNT_ID}:${LIVECHAT_PAT}`
  ).toString("base64")}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(attempt: number, retryAfterHeader: string | null) {
  if (retryAfterHeader) {
    const retryAfterSeconds = Number(retryAfterHeader);

    if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }
  }

  return BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
}

async function livechatRequest<T>(
  endpoint: string,
  options: RequestInit
): Promise<T> {
  let lastErrorText = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(`https://api.livechatinc.com${endpoint}`, {
      ...options,
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      cache: "no-store",
    });

    if (response.ok) {
      return response.json();
    }

    lastErrorText = await response.text();

    if (response.status !== 429 || attempt === MAX_RETRIES) {
      throw new Error(`LiveChat API error ${response.status}: ${lastErrorText}`);
    }

    const retryAfter = response.headers.get("retry-after");
    const delay = getRetryDelay(attempt, retryAfter);

    console.warn(
      `LiveChat rate limit 429. Retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`
    );

    await sleep(delay);
  }

  throw new Error(`LiveChat API error: ${lastErrorText || "Unknown error"}`);
}

export async function livechatPost<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  return livechatRequest<T>(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function livechatGet<T>(endpoint: string): Promise<T> {
  return livechatRequest<T>(endpoint, {
    method: "GET",
  });
}