// Data layer: Firebase Auth + Firestore + Storage (no server needed).
// Data model
//   users/{uid}                 username (lowercase, unique), name, bio, avatar, createdAt
//   usernames/{username}        { uid }   – claims a username
//   posts/{postId}              uid, title, type, media, mediaPath, thumb, thumbPath, width, height, views, likes, comments, createdAt
//   posts/{postId}/likes/{uid}  { createdAt }
//   posts/{postId}/comments/{id} uid, parentId, body, createdAt
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, addDoc, updateDoc, collection, query, where, orderBy, limit,
  writeBatch, increment, serverTimestamp, connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject, connectStorageEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';
import { firebaseConfig } from './firebase-config.js';
import { plainText } from './richtext.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// local development against the Firebase emulators: http://localhost:3000/?emulator=1
if (['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emulator')) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  // dev helper: sign in with a fake Google account without the popup (then reload the page)
  window.wcEmulatorSignIn = (email, name = email) => signInWithCredential(auth, GoogleAuthProvider.credential(
    JSON.stringify({ sub: email, email, email_verified: true, display_name: name, provider_id: 'google.com' })));
}

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
const ms = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : typeof t === 'number' ? t : Date.now());
export const currentUid = () => auth.currentUser?.uid ?? null;

/* ---------- users ---------- */
const userCache = new Map();
const toUser = (id, d) => ({ id, username: d.username, name: d.name, bio: d.bio || '', avatar: d.avatar || null });

export async function getUserById(uid) {
  if (!userCache.has(uid)) {
    userCache.set(uid, getDoc(doc(db, 'users', uid)).then((s) => (
      s.exists() ? toUser(uid, s.data()) : { id: uid, username: 'deleted', name: 'Deleted user', bio: '', avatar: null })));
  }
  return userCache.get(uid);
}

export async function getUserByUsername(username) {
  const s = await getDoc(doc(db, 'usernames', String(username).toLowerCase()));
  return s.exists() ? getUserById(s.data().uid) : null;
}

async function ensureProfile(fbUser) {
  const uid = fbUser.uid;
  userCache.delete(uid);
  const existing = await getDoc(doc(db, 'users', uid));
  if (existing.exists()) return getUserById(uid);

  // first login: claim a username derived from the email prefix
  const base = ((fbUser.email || 'user').split('@')[0].toLowerCase().replace(/[^a-z0-9_.]/g, '') || 'user')
    .slice(0, 18).padEnd(3, '_');
  for (let i = 0; i < 8; i++) {
    const username = i === 0 ? base : `${base}${Math.floor(100 + Math.random() * 99900)}`;
    if ((await getDoc(doc(db, 'usernames', username))).exists()) continue;
    const batch = writeBatch(db);
    batch.set(doc(db, 'usernames', username), { uid });
    batch.set(doc(db, 'users', uid), {
      username, name: (fbUser.displayName || username).slice(0, 40), bio: '',
      avatar: fbUser.photoURL || null, createdAt: serverTimestamp(),
    });
    try { await batch.commit(); break; } catch (e) { if (e.code !== 'permission-denied' || i === 7) throw e; }
  }
  return getUserById(uid);
}

/** Resolves once with the signed-in profile (or null) after Firebase restores the session. */
export function initAuth() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, async (fbUser) => {
      off();
      try { resolve(fbUser ? await ensureProfile(fbUser) : null); } catch (e) { console.error(e); resolve(null); }
    });
  });
}

export async function loginWithGoogle() {
  const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
  return ensureProfile(user);
}

export async function logout() {
  await signOut(auth);
  userCache.clear();
}

export async function updateProfile({ name, bio, avatarFile }) {
  const uid = currentUid();
  const data = { name, bio };
  if (avatarFile) {
    const path = `avatars/${uid}/${Date.now()}.${EXT[avatarFile.type] || 'jpg'}`;
    await uploadBytes(ref(storage, path), avatarFile, { contentType: avatarFile.type });
    data.avatar = await getDownloadURL(ref(storage, path));
  }
  await updateDoc(doc(db, 'users', uid), data);
  userCache.delete(uid);
  return getUserById(uid);
}

/* ---------- posts ---------- */
async function toPost(id, d) {
  return {
    id, title: d.title, type: d.type, media: d.media || null, thumb: d.thumb || null,
    mediaPath: d.mediaPath || null, thumbPath: d.thumbPath || null, excerpt: d.excerpt || '',
    blocks: (d.blocks || []).map((b) => ({
      side: b.side === 'right' ? 'right' : 'left', html: String(b.html || ''),
      media: b.media || null, mediaType: b.mediaType || null, mediaPath: b.mediaPath || null,
      thumb: b.thumb || null, thumbPath: b.thumbPath || null, width: b.width || 0, height: b.height || 0,
    })),
    width: d.width, height: d.height, views: d.views || 0, likes: d.likes || 0, comments: d.comments || 0,
    createdAt: ms(d.createdAt), author: await getUserById(d.uid),
  };
}

export async function listPosts({ type, uid } = {}) {
  const col = collection(db, 'posts');
  // single-field queries only, so no composite indexes are needed; type filter and sort happen here
  const q = uid ? query(col, where('uid', '==', uid), limit(200)) : query(col, orderBy('createdAt', 'desc'), limit(100));
  const snap = await getDocs(q);
  let posts = await Promise.all(snap.docs.map((d) => toPost(d.id, d.data())));
  if (type) posts = posts.filter((p) => p.type === type);
  return posts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPost(id) {
  const snap = await getDoc(doc(db, 'posts', id));
  if (!snap.exists()) return null;
  const post = await toPost(snap.id, snap.data());
  const uid = currentUid();
  const [liked, cs] = await Promise.all([
    uid ? getDoc(doc(db, 'posts', id, 'likes', uid)).then((s) => s.exists()) : false,
    getDocs(query(collection(db, 'posts', id, 'comments'), orderBy('createdAt'))),
  ]);
  post.liked = liked;
  const comments = await Promise.all(cs.docs.map(async (d) => ({
    id: d.id, parentId: d.data().parentId || null, body: d.data().body,
    createdAt: ms(d.data().createdAt), author: await getUserById(d.data().uid),
  })));
  return { post, comments };
}

export const addView = (id) => updateDoc(doc(db, 'posts', id), { views: increment(1) });

export async function toggleLike(postId) {
  const likeRef = doc(db, 'posts', postId, 'likes', currentUid());
  const postRef = doc(db, 'posts', postId);
  const liked = (await getDoc(likeRef)).exists();
  const batch = writeBatch(db);
  if (liked) { batch.delete(likeRef); batch.update(postRef, { likes: increment(-1) }); }
  else { batch.set(likeRef, { createdAt: serverTimestamp() }); batch.update(postRef, { likes: increment(1) }); }
  await batch.commit();
  return { liked: !liked, likes: (await getDoc(postRef)).data().likes };
}

export async function addComment(postId, body, parent) {
  const uid = currentUid();
  const parentId = parent ? (parent.parentId ?? parent.id) : null; // replies are one level deep
  const cRef = doc(collection(db, 'posts', postId, 'comments'));
  const batch = writeBatch(db);
  batch.set(cRef, { uid, parentId, body, createdAt: serverTimestamp() });
  batch.update(doc(db, 'posts', postId), { comments: increment(1) });
  await batch.commit();
  return { id: cRef.id, parentId, body, createdAt: Date.now(), author: await getUserById(uid) };
}

export async function deleteComments(postId, ids) {
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(doc(db, 'posts', postId, 'comments', id)));
  batch.update(doc(db, 'posts', postId), { comments: increment(-ids.length) });
  await batch.commit();
}

export async function createPost({ file, thumb, title, width, height, onProgress, signal }) {
  const uid = currentUid();
  const id = crypto.randomUUID().replaceAll('-', '');
  const mediaPath = `posts/${uid}/${id}.${EXT[file.type]}`;
  let thumbPath = null; let thumbUrl = null;
  if (thumb) {
    thumbPath = `posts/${uid}/${id}-thumb.jpg`;
    await uploadBytes(ref(storage, thumbPath), thumb, { contentType: 'image/jpeg' });
    thumbUrl = await getDownloadURL(ref(storage, thumbPath));
  }
  const task = uploadBytesResumable(ref(storage, mediaPath), file, { contentType: file.type });
  signal?.addEventListener('abort', () => task.cancel());
  await new Promise((resolve, reject) => task.on('state_changed',
    (s) => onProgress?.(s.bytesTransferred / s.totalBytes), reject, resolve));
  const media = await getDownloadURL(task.snapshot.ref);
  const docRef = await addDoc(collection(db, 'posts'), {
    uid, title, type: file.type.startsWith('video/') ? 'video' : 'photo',
    media, mediaPath, thumb: thumbUrl, thumbPath, width, height,
    views: 0, likes: 0, comments: 0, createdAt: serverTimestamp(),
  });
  return docRef.id;
}

/** A "Post": a title plus rows of text (rich HTML) with optional photo/video, placed left or right. */
export async function createArticle({ title, blocks, onProgress, signal }) {
  const uid = currentUid();
  const id = crypto.randomUUID().replaceAll('-', '');
  const total = blocks.flatMap((b) => [b.file, b.thumb]).filter(Boolean).reduce((n, f) => n + f.size, 0) || 1;
  let done = 0;
  const uploaded = [];
  const upload = async (path, blob, contentType) => {
    const r = ref(storage, path);
    const task = uploadBytesResumable(r, blob, { contentType });
    signal?.addEventListener('abort', () => task.cancel(), { once: true });
    await new Promise((resolve, reject) => task.on('state_changed',
      (s) => onProgress?.((done + s.bytesTransferred) / total), reject, resolve));
    done += blob.size;
    uploaded.push(path);
    return getDownloadURL(r);
  };
  try {
    const out = [];
    for (const [i, b] of blocks.entries()) {
      const o = { side: b.side, html: b.html, media: null, mediaType: null, mediaPath: null, thumb: null, thumbPath: null, width: 0, height: 0 };
      if (b.file) {
        o.mediaPath = `posts/${uid}/${id}-${i}.${EXT[b.file.type]}`;
        o.media = await upload(o.mediaPath, b.file, b.file.type);
        o.mediaType = b.file.type.startsWith('video/') ? 'video' : 'photo';
        o.width = b.width; o.height = b.height;
        if (b.thumb) {
          o.thumbPath = `posts/${uid}/${id}-${i}-thumb.jpg`;
          o.thumb = await upload(o.thumbPath, b.thumb, 'image/jpeg');
        }
      }
      out.push(o);
    }
    const cover = out.find((o) => o.media && (o.thumb || o.mediaType === 'photo'));
    const text = out.map((o) => plainText(o.html).trim()).find(Boolean) || '';
    const docRef = await addDoc(collection(db, 'posts'), {
      uid, title, type: 'post', blocks: out, excerpt: text.slice(0, 160),
      thumb: cover ? (cover.thumb || cover.media) : null, thumbPath: null,
      width: cover?.width || 1, height: cover?.height || 1,
      views: 0, likes: 0, comments: 0, createdAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (e) {
    await Promise.allSettled(uploaded.map((p) => deleteObject(ref(storage, p))));
    throw e;
  }
}

export async function deletePost(post) {
  // sub-collections first (the rules look at the parent post), best effort
  try {
    for (const sub of ['comments', 'likes']) {
      const docs = (await getDocs(collection(db, 'posts', post.id, sub))).docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
  } catch (e) { console.warn('cleanup failed', e); }
  const batch = writeBatch(db);
  batch.delete(doc(db, 'posts', post.id));
  await batch.commit();
  const paths = [post.mediaPath, post.thumbPath, ...post.blocks.flatMap((b) => [b.mediaPath, b.thumbPath])];
  await Promise.allSettled(paths.filter(Boolean).map((p) => deleteObject(ref(storage, p))));
}
