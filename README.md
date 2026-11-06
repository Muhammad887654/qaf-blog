# QAF Blog

Blog QAF with email/password registration, account profiles, and private member posts.

## Run locally

1. Install Node.js 18 or newer.
2. From this folder, run `npm start`.
3. Open <http://localhost:3000> for the home page.
4. Choose **Masuk dan Berkaryalah** to open the separate <http://localhost:3000/login> page.
5. On the login page, choose **Buat akun baru** and use a password with at least 10 characters.

The home page links to the local QAF Berbagi interface at <http://localhost:3000/berbagi/>. Its campaign, donation, and treasurer API runs in this server and uses Supabase.

## Configure QAF Berbagi

1. Create a Supabase project and run [`db/qaf-berbagi-schema.sql`](./db/qaf-berbagi-schema.sql) in its SQL Editor to create the campaign and donation tables and sample campaigns.
2. Copy `.env.example` to `.env`. Set `SUPABASE_URL`, the server-only `SUPABASE_SERVICE_ROLE_KEY`, and a long random `ADMIN_KEY`. `BANK_INFO` is optional and only adds bank-transfer details alongside the existing QAF QRIS code. Never expose the service-role key in frontend code or commit `.env`.
3. Run `npm install` and restart with `npm start`.
4. Open <http://localhost:3000/berbagi/>. Use <http://localhost:3000/berbagi/admin.html> for the treasurer panel.

Campaign listing, donation submission (including proof uploads), verification, and campaign management use the QAF Berbagi API routes in `berbagi-api.js`. The existing QRIS image is served locally from `public/berbagi/qris-qaf.jpg`. Uploaded proofs are kept in the ignored `uploads/` directory; production deployments need persistent storage for it. If the required environment variables are missing, the API reports a configuration error instead of showing an empty success state.

The Node.js backend is `server.js`. User records and posts are stored in `data/qaf-blog.json`, which is intentionally excluded from Git. Passwords are stored as scrypt hashes. Session cookies are HttpOnly and SameSite, and sessions expire when the server restarts.

After signing in, a user can set a display name, short bio, and profile photo in **Profil akun**. Profile photos support PNG, JPEG, and WebP files up to 2 MB. Posts and profile data are private to the signed-in account.

## Publish

Push this project to GitHub, then deploy it to a Node.js host that provides persistent disk storage. Configure the service to run `npm start`, set `NODE_ENV=production`, and mount persistent storage for the `data/` directory. The server binds to `0.0.0.0` and uses the host-provided `PORT`.

GitHub Pages only serves static files and cannot run this backend. Do not publish `data/qaf-blog.json` or use the file-based database on an ephemeral host without persistent storage.
