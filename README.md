# WhyConnect 🌐

A small photo & video social network.

- **Profile page** – avatar, name, bio, `ALL / Photo / Video` filter and a masonry grid of posts.
- **Hover** a post → title + ❤ likes · 👁 views · 💬 comments appear over a softened preview.
- **Click** a post → full post page with the media, author, stats, threaded comments and a comment box.
- Upload photos & videos with the **+** button (video posters are generated in the browser).
- Sign up / log in, like, comment, reply, edit your profile, delete your own posts/comments.

## Run it

Requires Node.js **22.13+** (uses the built-in `node:sqlite`).

```bash
npm install
npm start          # http://localhost:3000
```

On first start the app seeds demo data (two users, a few posts, a comment thread).
Demo logins: `eunu` / `demo1234` and `james` / `demo1234`.
Seed videos are generated with `ffmpeg` if it is installed (skipped otherwise).

| Command | What it does |
| --- | --- |
| `npm run dev` | start with auto-reload |
| `npm run seed` | wipe the DB and re-seed demo data |
| `PORT=8080 npm start` | change the port |
| `SEED=0 npm start` | don't seed demo data |
| `DATA_DIR=/path npm start` | where the SQLite DB and uploads live (default `./data`) |

## Google login

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → *Create credentials* → *OAuth client ID* → **Web application**.
2. Add your site origin (e.g. `http://localhost:3000` and your production URL) to **Authorized JavaScript origins**. No redirect URI is needed.
3. `cp .env.example .env` and set `GOOGLE_CLIENT_ID=...`, then restart.

Without `GOOGLE_CLIENT_ID` the Google button is simply hidden and username/password login still works.
First-time Google users get an account created automatically (username from their email prefix).

## Structure

```
server/   Express API, SQLite schema, seed script
public/   index.html, styles.css, app.js  (vanilla JS, hash router: #/ · #/u/:username · #/p/:id)
data/     SQLite DB + uploaded files (git-ignored)
```

## API (JSON)

`GET /api/me` · `POST /api/signup|login|logout` · `PATCH /api/me`
`GET /api/users/:username` · `GET /api/posts?type=photo|video&user=` · `POST /api/posts` (multipart)
`GET /api/posts/:id` · `POST /api/posts/:id/like|view|comments` · `DELETE /api/posts/:id` · `DELETE /api/comments/:id`

## Notes / next steps

- Uploads are stored on local disk, so deploy on a host with persistent storage (or swap in S3-style storage).
- No rate limiting or email verification yet.
