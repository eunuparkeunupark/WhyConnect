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
