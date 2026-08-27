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

Copy `.env.example` to `.env.local` and fill in the Supabase public values. The
weekly Planner works without an AI key by using deterministic estimates. To add
chat-based interpretation and richer assignment estimates, configure
`DEEPSEEK_API_KEY`; `DEEPSEEK_MODEL` defaults to `deepseek-v4-flash`.

The Planner migration is in `lib/supabase/planner-migration.sql`. Until that
migration is applied, planner state is kept per user in the browser so the UI can
still be tested safely.

## Google sign-in production configuration

The application code uses Supabase's PKCE callback at `/auth/callback`. Complete
all of the following dashboard configuration before treating Google sign-in as
production-ready:

1. In Vercel, set `NEXT_PUBLIC_SITE_URL` to the canonical application origin:
   `https://www.myorderlyapp.com`. Apply it to Production only, then redeploy.
   Leave it unset for previews so the PKCE callback returns to the same preview
   origin that created the verifier cookie.
2. In **Supabase > Authentication > URL Configuration**, set **Site URL** to
   `https://www.myorderlyapp.com` and add the exact production redirect URL
   `https://www.myorderlyapp.com/auth/callback`. Add
   `http://localhost:3000/auth/callback` for local development. Avoid a broad
   production wildcard; add a specific stable Vercel preview pattern only when
   preview OAuth is intentionally supported. See [Supabase redirect URL
   guidance](https://supabase.com/docs/guides/auth/redirect-urls).
3. In **Supabase > Authentication > Sign In / Providers > Google**, enable the
   provider and store the Web OAuth client's ID and secret there. These values
   are server-side Supabase configuration and do not belong in `NEXT_PUBLIC_*`
   variables.
4. In **Google Auth Platform > Clients**, the Web OAuth client's authorized
   redirect URI must be the Supabase provider callback shown in the Supabase
   Google-provider panel, normally
   `https://<project-ref>.supabase.co/auth/v1/callback`. It is not the Orderly
   `/auth/callback` URL. Google requires an exact match, including scheme and
   trailing slash. See [Supabase's Google provider
   guide](https://supabase.com/docs/guides/auth/social-login/auth-google) and
   [Google's redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).
5. In **Google Auth Platform > Branding**, set the app name to `Orderly`, select
   a monitored support email, upload the Orderly logo, and set:
   - Home page: `https://www.myorderlyapp.com/landing`
   - Privacy policy: `https://www.myorderlyapp.com/privacy`
   - Terms: `https://www.myorderlyapp.com/terms`
   - Authorized domain: `myorderlyapp.com`

   Set the audience to External and publish when the app should be available to
   users beyond the test-user list. Google requires brand verification before
   the verified app name and logo appear publicly; see [Google's branding
   configuration](https://support.google.com/cloud/answer/15549049).

Google can still display the Supabase project hostname during the provider
handoff even when the Orderly brand is configured. Replacing that hostname
requires a Supabase custom domain such as `auth.myorderlyapp.com` (a paid
Supabase add-on). After activating it, add both the old and new provider
callbacks to the Google client during the transition, update
`NEXT_PUBLIC_SUPABASE_URL` to the custom origin, and redeploy. Follow
[Supabase's custom-domain OAuth migration steps](https://supabase.com/docs/guides/platform/custom-domains).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
