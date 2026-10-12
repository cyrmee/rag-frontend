"use client";

import Keycloak from "keycloak-js";
import { createContext, useContext, useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";

// Sign-in is Keycloak's job: the app sends users to Keycloak's login page,
// gets an access token back, and sends it with every backend request (see
// lib/api.ts). Profile, password and session management happen in
// Keycloak's own account console - see accountUrl below.
const KEYCLOAK_URL = process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8180";
const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "rag";
const KEYCLOAK_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "rag-frontend";

export type AuthUser = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
};

type AuthContextValue = {
  user: AuthUser;
  accountUrl: string;
  logout: () => void;
};

let keycloak: Keycloak | null = null;
let initPromise: Promise<boolean> | null = null;

// keycloak-js needs crypto.randomUUID (and crypto.subtle for PKCE), which
// browsers only provide in a secure context: https or localhost. The app
// is also opened over plain http on this machine's Tailscale IP, where
// both are missing - there, generate UUIDs from getRandomValues (which
// is available) and skip PKCE. The test realm doesn't require it.
function ensureRandomUUID() {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID === "function") return;
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}

function getKeycloak(): Keycloak {
  if (!keycloak) {
    ensureRandomUUID();
    keycloak = new Keycloak({ url: KEYCLOAK_URL, realm: KEYCLOAK_REALM, clientId: KEYCLOAK_CLIENT_ID });
  }
  return keycloak;
}

// Runs once per page load, even though React's dev-mode double effects
// would call it twice - keycloak-js refuses a second init().
function initKeycloak(): Promise<boolean> {
  if (!initPromise) {
    initPromise = getKeycloak().init({
      onLoad: "login-required",
      pkceMethod: window.isSecureContext ? "S256" : false,
      checkLoginIframe: false,
    });
  }
  return initPromise;
}

// A valid access token for a backend request, refreshed first if it
// expires within 30 seconds. If the session itself is over, this sends
// the browser back to the login page.
export async function getAccessToken(): Promise<string> {
  const kc = getKeycloak();
  await initKeycloak();
  try {
    await kc.updateToken(30);
  } catch {
    await kc.login();
    throw new Error("Your session has ended - signing you in again.");
  }
  if (!kc.token) throw new Error("Not signed in.");
  return kc.token;
}

// For a 401 from the backend: the token was rejected, so start over.
export function signInAgain(): void {
  void getKeycloak().login();
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<AuthContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initKeycloak()
      .then((authenticated) => {
        const kc = getKeycloak();
        if (!authenticated || !kc.tokenParsed) {
          void kc.login();
          return;
        }
        const claims = kc.tokenParsed as Record<string, unknown>;
        const str = (key: string) => (typeof claims[key] === "string" ? (claims[key] as string) : null);
        setValue({
          user: {
            id: String(claims.sub ?? ""),
            username: str("preferred_username") ?? String(claims.sub ?? ""),
            name: str("name"),
            email: str("email"),
          },
          accountUrl: kc.createAccountUrl(),
          logout: () => void kc.logout({ redirectUri: `${window.location.origin}/` }),
        });
      })
      .catch(() => {
        setError(`Couldn't reach the sign-in server at ${KEYCLOAK_URL}.`);
      });
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }
  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-label="Signing in">
        <Spinner />
      </div>
    );
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
