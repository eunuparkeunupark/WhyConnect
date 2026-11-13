# WhyConnect 🌐

A small photo & video social network. **No server**: a static site (hosted on Vercel) talking directly to
Firebase Auth (Google login), Firestore (data) and Cloud Storage (photos/videos), protected by security rules.

- **Profile page** – avatar, name, bio, `ALL / Photo / Video` filter, masonry grid.
- Three kinds of content: **Photo**, **Video** and **Post** (a title plus rows of formatted text with an optional photo/video on the left or right). The profile filter is `ALL / Photo / Video / Post`.
- **Hover** a post → title + ❤ likes · 👁 views · 💬 comments. **Click** → full post page with threaded comments.
- `+` opens the composer (`#/new`): pick Post / Photo / Video, add media, format text (font, size, bold/italic/underline, text & highlight color), `+` adds a row, `→` moves the media to the other side. Video posters are generated in the browser. Google login, likes, comments, replies, edit profile, delete own content.

```
public/            the whole site (index.html, styles.css, app.js UI, composer.js, richtext.js, data.js Firebase layer, firebase-config.js)
firebase/          firestore.rules + storage.rules  (must be published, see below)
firebase.json      emulator + rules config      vercel.json   static hosting config
```

## 1. Firebase setup (once)

In the [Firebase console](https://console.firebase.google.com) → project `whyconnect-f9714`:

1. **Authentication → Sign-in method → Google** → enable.
2. **Authentication → Settings → Authorized domains** → add your site domain(s), e.g. `whyconnect.eunupark.com` and your `*.vercel.app` domain (`localhost` is there by default).
3. **Firestore Database → Create database** (production mode, pick a region). Then **Rules** tab → paste `firebase/firestore.rules` → **Publish**.
4. **Storage → Get started** (requires the **Blaze** pay-as-you-go plan; the free quota is generous). **Rules** tab → paste `firebase/storage.rules` → **Publish**.

Or with the CLI: `npx firebase-tools login && npm run deploy:rules`.

## 2. Run locally

```bash
npm install
npm start          # http://localhost:3000
```

Uses the real Firebase project. For a fully local sandbox run `npm run emulators` (needs Java) and open `http://localhost:3000/?emulator=1`;
in that mode `wcEmulatorSignIn('me@example.com')` in the browser console signs in without the popup (reload afterwards).

## 3. Deploy on Vercel + custom domain

1. Import the GitHub repo in Vercel. `vercel.json` already sets *no build, output directory `public`*.
2. Project → **Settings → Domains** → add `whyconnect.eunupark.com`. At your DNS provider create a **CNAME** record `whyconnect` → `cname.vercel-dns.com` (or the value Vercel shows).
3. Add that domain to Firebase **Authorized domains** (step 1.2) – otherwise Google login fails with `auth/unauthorized-domain`.

## Data model

```
users/{uid}                  username (unique, lowercase), name, bio, avatar
usernames/{username}         { uid }                     – claim record that keeps usernames unique
posts/{id}                   uid, title, type (photo|video|post), media, mediaPath, thumb, width, height, views, likes, comments, createdAt
                             type=post: blocks[{side, html, media, mediaType, thumb, ...}], excerpt
posts/{id}/likes/{uid}       like marker (one per user)
posts/{id}/comments/{id}     uid, parentId, body, createdAt
```

Security rules enforce: you can only write as yourself; counters move by ±1 and likes are backed by a like document;
only the author can delete a post; usernames are unique; uploads are limited by type/size and stored under your own uid.
Post text is stored as HTML and is re-sanitized (strict tag/style whitelist) every time it is displayed.
The `firebaseConfig` values in `public/firebase-config.js` are public identifiers, not secrets – the rules are what protect the data.
