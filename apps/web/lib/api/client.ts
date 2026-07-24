import { createApiClient } from "@sigmagit/lib";
import type { ApiClient } from "@sigmagit/hooks";
import { getApiUrl } from "@/lib/utils";

/**
 * Browser API client uses HttpOnly session cookies (credentials: include).
 * Do not put session bearer tokens in JavaScript-accessible storage or headers —
 * that would expand XSS impact. CLI/service clients still use Authorization/API keys.
 */
const baseClient = createApiClient({
  baseUrl: getApiUrl() || "",
  getAuthHeaders: async (): Promise<HeadersInit> => {
    return {};
  },
  fetchOptions: {
    credentials: "include",
  },
});

export const api = {
  ...baseClient,
  settings: {
    ...baseClient.settings,
    updateAvatar: async (file: File) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        throw new Error("API URL not configured");
      }

      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch(`${apiUrl}/api/settings/avatar`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to upload avatar");
      }
      return res.json();
    },
  },
} as unknown as ApiClient;
