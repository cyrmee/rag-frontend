This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Sign-in

The app signs users in with Keycloak (`lib/auth.tsx`, using keycloak-js)
before it renders anything, and sends the access token with every backend
request (`lib/api.ts`). Each user sees only their own chat history. The
account menu in the sidebar footer links to Keycloak's account console
(profile, password, sessions) and signs out.

Configure it in `.env.local` (see `.env.example`):
`NEXT_PUBLIC_KEYCLOAK_URL`, `NEXT_PUBLIC_KEYCLOAK_REALM`,
`NEXT_PUBLIC_KEYCLOAK_CLIENT_ID`. For testing, rag-backend's docker
compose runs a Keycloak with users alice/alice and bob/bob. Its client
accepts redirects to `http://localhost:3000` and `http://100.90.77.15:3000`;
another address needs adding to the client's redirect URIs.

Over plain http on a non-localhost address, browsers withhold the crypto
APIs keycloak-js needs, so the app fills in `crypto.randomUUID` and skips
PKCE there. Serve it over https in production and PKCE is used.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
