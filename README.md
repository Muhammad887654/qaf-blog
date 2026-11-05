# QAF Blog

Blog QAF with email/password registration, account profiles, and private member posts.

## Run locally

1. Install Node.js 18 or newer.
2. From this folder, run `npm start`.
3. Open <http://localhost:3000>.
4. Choose **Buat akun baru** and use a password with at least 10 characters.

The app has no external npm dependencies. Frontend files are in `public/`; the Node.js backend is `server.js`. User records and posts are stored in `data/qaf-blog.json`, which is intentionally excluded from Git. Passwords are stored as scrypt hashes. Session cookies are HttpOnly and SameSite, and sessions expire when the server restarts.

After signing in, a user can set a display name and short bio in **Profil akun**. Posts and profile data are private to the signed-in account.

## Publish

Push this project to GitHub, then deploy it to a Node.js host that provides persistent disk storage. Configure the service to run `npm start`, set `NODE_ENV=production`, and mount persistent storage for the `data/` directory. The server binds to `0.0.0.0` and uses the host-provided `PORT`.

GitHub Pages only serves static files and cannot run this backend. Do not publish `data/qaf-blog.json` or use the file-based database on an ephemeral host without persistent storage.
