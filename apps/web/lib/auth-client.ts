import { createAuthClient } from "better-auth/react";
import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { getApiUrl } from "./utils";

export const authClient = createAuthClient({
  baseURL: getApiUrl(),
  plugins: [apiKeyClient(), passkeyClient()],
  sessionCache: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 1000, // update every hour
  },
});

export const { signIn, signOut, useSession } = authClient;

export async function signUpWithUsername(data: { email: string; password: string; name: string; username: string }) {
  return authClient.signUp.email(data);
}
