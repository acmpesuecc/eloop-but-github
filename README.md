# [eloop](https://hsp-ec.xyz/eloop) — An Event Management Platform

A lightweight, serverless event-management frontend built with Next.js. Supports hierarchical roles, dynamic registration forms, and QR-based check-ins. This repository was forked from [HSP](https://hsp-ec.xyz) by [ACM PESUECC](https://pesuecc.acm.org).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Facmpesuecc%2Feloop-but-github)

<details>
<summary>Set these environments after clicking Deploy to Vercel</summary>

## Setup Env variables

The project reads configuration from environment variables. If you deploy with Vercel you can connect Turso under `Vercel/Storage` directly from your Vercel project. Vercel's integrations will provision resources and copy the required `TURSO_` environment variables into your project automatically.

- `ADMIN_EMAIL` — the email granted the initial Admin role on first sign-in
- `GOOGLE_CLIENT_ID` — Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` — Google OAuth client secret
- `NEXTAUTH_URL` — canonical site URL (e.g. `https://your-site.vercel.app`)
- `NEXTAUTH_SECRET` — secret for NextAuth session encryption
- `QR_SECRET` — secret used to sign QR payloads
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — provisioned by Vercel when you add the Turso integration and connect it to your project. If you manage the database outside Vercel, add these variables manually with the values from your Turso dashboard or CLI.

### Google OAuth Client Setup

1. **Open [Google Console](https://console.cloud.google.com).**
2. **Access Google Auth Platform**  
 Click on `View all products` at the bottom of the page.  
 Locate and select **Google Auth Platform**.
3. **Create a New OAuth Client**  

- Navigate to the **Clients** tab.
- Click **Create Client**.
- Set `Application Type` to **Web Application**.

1. **Configure URIs**  

- **Authorised JavaScript origins**:  
   Add your frontend URL (e.g., `https://your-frontend.vercel.app`).
- **Authorised redirect URIs**:  
   Add your backend callback URL (e.g., `https://your-frontend.vercel.app/api/auth/callback/google`).

1. **Finish Setup**  

- Click **Create** to generate your client credentials.
- Copy the `Client ID` and `Client Secret` for use in your environment variables.

### Database Setup

1. In the Vercel dashboard, open your project and go to Integrations → Install Integrations.
2. Find "Turso" and follow the prompts to provision a database for your project. During installation Vercel will add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to your project's environment variables automatically.

Deploy the project. On first run the app checks for required tables and will initialize the database automatically. The user who signs in with the `ADMIN_EMAIL` address will be granted the Admin role.

If you prefer to manage the database outside Vercel, you can still create a Turso DB via the Turso dashboard or CLI and copy the resulting `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` into your Vercel environment variables. However, using the Vercel integration is the easiest way to ensure the env vars are wired into your deployment.

### Other Variables

- `QR_EXPIRATION` — optional default expiration for generated QR tokens (e.g. `30d`, `7d`, `10m`). If not set, defaults to `30d` in the application.
- `POSTHOG_KEY` — optional instrumentation key (e.g. `phc_xxx`)

---

</details>

## License

- This project is licensed under AGPL
- PRs are welcome. For major changes, open an issue first to discuss the design and scope.
- Original concept & backend: <https://github.com/homebrew-ec-foss/eventloop>
- Tilde 4 Project: <https://homebrew.hsp-ec.xyz/posts/tilde-4.0-eventloop/>
