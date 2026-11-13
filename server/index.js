import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { db, ROOT, UPLOAD_DIR, hashPassword, verifyPassword } from './db.js';
import { seedIfEmpty } from './seed.js';

const PORT = Number(process.env.PORT) || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const SESSION_COOKIE = 'wc_session';
const SESSION_MAX_AGE = 30 * 24 * 3600; // seconds

const MEDIA_TYPES = {
  'image/jpeg': ['photo', '.jpg'],
  'image/png': ['photo', '.png'],
  'image/webp': ['photo', '.webp'],
  'image/gif': ['photo', '.gif'],
  'image/avif': ['photo', '.avif'],
  'video/mp4': ['video', '.mp4'],
  'video/webm': ['video', '.webm'],
  'video/quicktime': ['video', '.mov'],
};
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- upload handling ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = (MEDIA_TYPES[file.mimetype]?.[1]) || IMAGE_EXT[file.mimetype] || '';
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => {
    const ok = file.fieldname === 'media' ? MEDIA_TYPES[file.mimetype]
      : IMAGE_EXT[file.mimetype];
    cb(ok ? null : new HttpError(415, 'Unsupported file type'), !!ok);
  },
});
const removeFiles = (...files) => files.flat().filter(Boolean)
  .forEach((f) => fs.unlink(f.path ?? f, () => {}));

// ---------- helpers ----------
const now = () => Date.now();
const clampInt = (v, min, max, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const urlOf = (file) => (file ? `/uploads/${file.filename}` : null);

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, userId, now());
  const secure = req.secure || process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}${secure}`);
}

const publicUser = (u) => u && ({ id: u.id, username: u.username, name: u.name, bio: u.bio, avatar: u.avatar });

const POST_SELECT = `
  SELECT p.id, p.title, p.type, p.media, p.thumb, p.width, p.height, p.views, p.created_at,
         u.id AS user_id, u.username, u.name AS user_name, u.avatar AS user_avatar,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)    AS likes,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments,
         EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
  FROM posts p JOIN users u ON u.id = p.user_id`;

const publicPost = (r) => ({
  id: r.id, title: r.title, type: r.type, media: r.media, thumb: r.thumb,
  width: r.width, height: r.height, views: r.views, createdAt: r.created_at,
  likes: r.likes, comments: r.comments, liked: !!r.liked,
  author: { id: r.user_id, username: r.username, name: r.user_name, avatar: r.user_avatar },
});

const getPost = (id, viewerId) => {
  const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(viewerId ?? 0, id);
  return row ? publicPost(row) : null;
};

function requireUser(req) {
  if (!req.user) throw new HttpError(401, 'Please log in first');
  return req.user;
}
const needUser = (req, res, next) => { requireUser(req); next(); };

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  req.sessionToken = token;
  req.user = token
    ? db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token)
    : null;
  next();
});

// uploaded files: never let them run as pages
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d', immutable: true,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  },
}));
app.use(express.static(path.join(ROOT, 'public')));

// ----- auth -----
app.get('/api/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID || null }));

app.post('/api/auth/google', async (req, res) => {
  if (!googleClient) throw new HttpError(503, 'Google login is not configured');
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: String(req.body.credential ?? ''), audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch { throw new HttpError(401, 'Google sign-in failed'); }
  if (!payload?.sub || !payload.email_verified) throw new HttpError(401, 'Google account email is not verified');

  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(payload.sub);
  if (!user) {
    // derive a unique username from the email's local part
    const base = (payload.email.split('@')[0].replace(/[^a-zA-Z0-9_.]/g, '') || 'user').slice(0, 18).padEnd(3, '_');
    let username = base;
    while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      username = `${base}${crypto.randomInt(100, 99999)}`;
    }
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO users (username, name, avatar, password_hash, google_sub, created_at) VALUES (?,?,?,?,?,?)',
    ).run(username, (payload.name || username).slice(0, 40), payload.picture || null, '!', payload.sub, now());
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  }
  setSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/signup', (req, res) => {
  const username = String(req.body.username ?? '').trim();
  const name = String(req.body.name ?? '').trim() || username;
  const password = String(req.body.password ?? '');
  if (!/^[a-zA-Z0-9_.]{3,24}$/.test(username)) throw new HttpError(400, 'Username: 3-24 letters, numbers, _ or .');
  if (name.length > 40) throw new HttpError(400, 'Name is too long');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken');
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (username, name, password_hash, created_at) VALUES (?,?,?,?)',
  ).run(username, name, hashPassword(password), now());
  setSession(req, res, Number(lastInsertRowid));
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid)) });
});

app.post('/api/login', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body.username ?? '').trim());
  if (!user || !verifyPassword(String(req.body.password ?? ''), user.password_hash)) {
    throw new HttpError(401, 'Wrong username or password');
  }
  setSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.patch('/api/me', needUser, upload.single('avatar'), (req, res) => {
  try {
    const me = requireUser(req);
    const name = req.body.name === undefined ? me.name : String(req.body.name).trim();
    const bio = req.body.bio === undefined ? me.bio : String(req.body.bio).slice(0, 200);
    if (!name || name.length > 40) throw new HttpError(400, 'Name must be 1-40 characters');
    const avatar = req.file ? urlOf(req.file) : me.avatar;
    db.prepare('UPDATE users SET name = ?, bio = ?, avatar = ? WHERE id = ?').run(name, bio, avatar, me.id);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(me.id)) });
  } catch (e) { removeFiles(req.file); throw e; }
});

// ----- users -----
app.get('/api/users/:username', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!u) throw new HttpError(404, 'User not found');
  const stats = db.prepare(`
    SELECT COUNT(*) AS posts,
           COALESCE(SUM((SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)), 0) AS likes
    FROM posts p WHERE p.user_id = ?`).get(u.id);
  res.json({ user: publicUser(u), stats });
});

// ----- posts -----
app.get('/api/posts', (req, res) => {
  const where = []; const params = [req.user?.id ?? 0];
  if (req.query.type === 'photo' || req.query.type === 'video') { where.push('p.type = ?'); params.push(req.query.type); }
  if (req.query.user) { where.push('u.username = ?'); params.push(String(req.query.user)); }
  if (req.query.before) { where.push('p.id < ?'); params.push(clampInt(req.query.before, 0, 2 ** 53, 0)); }
  const limit = clampInt(req.query.limit, 1, 100, 60);
  const rows = db.prepare(
    `${POST_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT ${limit}`,
  ).all(...params);
  res.json({ posts: rows.map(publicPost) });
});

app.post('/api/posts', needUser, upload.fields([{ name: 'media', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), (req, res) => {
  const media = req.files?.media?.[0]; const thumb = req.files?.thumb?.[0];
  try {
    const me = requireUser(req);
    if (!media) throw new HttpError(400, 'Choose a photo or video');
    const title = String(req.body.title ?? '').trim();
    if (!title || title.length > 100) throw new HttpError(400, 'Title must be 1-100 characters');
    const type = MEDIA_TYPES[media.mimetype][0];
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO posts (user_id, title, type, media, thumb, width, height, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    ).run(me.id, title, type, urlOf(media), urlOf(thumb),
      clampInt(req.body.width, 1, 20000, 1000), clampInt(req.body.height, 1, 20000, 1000), now());
    res.status(201).json({ post: getPost(Number(lastInsertRowid), me.id) });
  } catch (e) { removeFiles(media, thumb); throw e; }
});

app.get('/api/posts/:id', (req, res) => {
  const post = getPost(Number(req.params.id), req.user?.id);
  if (!post) throw new HttpError(404, 'Post not found');
  const comments = db.prepare(`
    SELECT c.id, c.parent_id, c.body, c.created_at, u.id AS user_id, u.username, u.name, u.avatar
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id`).all(post.id)
    .map(commentJson);
  res.json({ post, comments });
});

const commentJson = (c) => ({
  id: c.id, parentId: c.parent_id, body: c.body, createdAt: c.created_at,
  author: { id: c.user_id, username: c.username, name: c.name, avatar: c.avatar },
});

app.post('/api/posts/:id/view', (req, res) => {
  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', (req, res) => {
  const me = requireUser(req);
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(id)) throw new HttpError(404, 'Post not found');
  const del = db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(me.id, id);
  if (!del.changes) db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?,?)').run(me.id, id);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?').get(id);
  res.json({ liked: !del.changes, likes: n });
});

app.delete('/api/posts/:id', (req, res) => {
  const me = requireUser(req);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!post) throw new HttpError(404, 'Post not found');
  if (post.user_id !== me.id) throw new HttpError(403, 'Not your post');
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  removeFiles(...[post.media, post.thumb].filter(Boolean).map((u) => path.join(UPLOAD_DIR, path.basename(u))));
  res.json({ ok: true });
});

// ----- comments -----
app.post('/api/posts/:id/comments', (req, res) => {
  const me = requireUser(req);
  const postId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(postId)) throw new HttpError(404, 'Post not found');
  const body = String(req.body.body ?? '').trim();
  if (!body || body.length > 500) throw new HttpError(400, 'Comment must be 1-500 characters');
  let parentId = req.body.parentId ? Number(req.body.parentId) : null;
  if (parentId) {
    const parent = db.prepare('SELECT * FROM comments WHERE id = ? AND post_id = ?').get(parentId, postId);
    if (!parent) throw new HttpError(400, 'Comment to reply to not found');
    parentId = parent.parent_id ?? parent.id; // replies are one level deep
  }
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO comments (post_id, user_id, parent_id, body, created_at) VALUES (?,?,?,?,?)',
  ).run(postId, me.id, parentId, body, now());
  const row = db.prepare(`
    SELECT c.id, c.parent_id, c.body, c.created_at, u.id AS user_id, u.username, u.name, u.avatar
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(lastInsertRowid);
  res.status(201).json({ comment: commentJson(row) });
});

app.delete('/api/comments/:id', (req, res) => {
  const me = requireUser(req);
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(req.params.id));
  if (!c) throw new HttpError(404, 'Comment not found');
  if (c.user_id !== me.id) throw new HttpError(403, 'Not your comment');
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ----- errors -----
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? 'File is too large (max 200MB)' : err.message });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
});

if (process.env.SEED !== '0') seedIfEmpty();
app.listen(PORT, () => console.log(`WhyConnect running → http://localhost:${PORT}`));
