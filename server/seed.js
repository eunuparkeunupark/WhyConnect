// Demo data: generates SVG artwork (and short videos if ffmpeg is installed) so the app
// looks alive on first run. Demo accounts use the password "demo1234".
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { db, UPLOAD_DIR, hashPassword } from './db.js';

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// triangulated "low poly" field
function lowPoly(w, h, palette, seed, cols = 9, rows = 8) {
  const r = rng(seed);
  const pts = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const jx = i === 0 || i === cols ? 0 : (r() - 0.5) * (w / cols) * 0.8;
      const jy = j === 0 || j === rows ? 0 : (r() - 0.5) * (h / rows) * 0.8;
      pts.push([(i * w) / cols + jx, (j * h) / rows + jy]);
    }
  }
  const at = (i, j) => pts[j * (cols + 1) + i];
  const pick = () => palette[Math.floor(r() * palette.length)];
  let out = '';
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      for (const tri of [[at(i, j), at(i + 1, j), at(i, j + 1)], [at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]]) {
        out += `<polygon points="${tri.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="${pick()}" stroke="${pick()}" stroke-width=".6"/>`;
      }
    }
  }
  return out;
}

const svg = (w, h, body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;

const BLUES = ['#1d4fa8', '#2563c4', '#1a449a', '#0f3279', '#2f78dd', '#153b86', '#3a86e8'];
const ORANGES = ['#ff6a1f', '#ff7a2e', '#f45a10', '#ff8a45', '#ffa566', '#e84f0c', '#ffb98a'];

function helmet() {
  const shape = 'M150 520 C120 300 280 130 520 150 C720 168 790 330 760 470 L690 505 C640 480 590 500 560 540 L330 560 Z';
  return svg(900, 800, `
    ${lowPoly(900, 800, BLUES, 7, 10, 9)}
    <clipPath id="c"><path d="${shape}"/></clipPath>
    <g clip-path="url(#c)">${lowPoly(900, 800, ORANGES, 21, 12, 10)}</g>
    <path d="${shape}" fill="none" stroke="#c9480b" stroke-width="4"/>
    <path d="M610 455 L760 410 L800 520 L700 640 L560 600 Z" fill="none" stroke="#6b7280" stroke-width="16" stroke-linejoin="round"/>
    <path d="M640 520 L790 470 M620 580 L760 560" stroke="#6b7280" stroke-width="12" stroke-linecap="round"/>
    <path d="M300 250 H500 V320 H455 V470 H500 V540 H300 V470 H345 V320 H300 Z" fill="#e7e9ee" stroke="#2a3d8f" stroke-width="12" stroke-linejoin="round" transform="translate(40 -10) scale(.9)"/>
    <text x="205" y="470" font-family="Arial" font-weight="900" font-size="44" fill="#fff" stroke="#2a3d8f" stroke-width="2">14</text>`);
}

function aurora() {
  const r = rng(5);
  let trees = '';
  for (let i = 0; i < 70; i++) {
    const x = (i / 70) * 900 + r() * 20; const h = 90 + r() * 150;
    trees += `<polygon points="${x},${560 - h} ${x - 22 - r() * 10},560 ${x + 22 + r() * 10},560" fill="#0b1a1f"/>`;
  }
  return svg(900, 560, `
    <rect width="900" height="560" fill="url(#sky)"/>
    ${[...Array(60)].map(() => `<circle cx="${r() * 900}" cy="${r() * 300}" r="${r() * 1.3 + 0.3}" fill="#fff" opacity="${0.4 + r() * 0.6}"/>`).join('')}
    <g filter="url(#blur)">
      <path d="M-20 330 C200 120 360 280 520 150 S800 90 940 220 L940 330 C760 220 620 330 480 300 S180 420 -20 330Z" fill="url(#g1)" opacity=".85"/>
      <path d="M-20 390 C240 230 420 340 600 230 S820 200 940 290 L940 380 C780 300 620 400 460 370 S160 470 -20 390Z" fill="url(#g2)" opacity=".7"/>
    </g>
    <rect y="470" width="900" height="90" fill="#0b1a1f"/>${trees}`,
  `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#150c3a"/><stop offset="1" stop-color="#1b3a4b"/></linearGradient>
   <linearGradient id="g1" x1="0" x2="1"><stop offset="0" stop-color="#34f5a0"/><stop offset=".6" stop-color="#7a5cff"/><stop offset="1" stop-color="#d44cff"/></linearGradient>
   <linearGradient id="g2" x1="0" x2="1"><stop offset="0" stop-color="#b24cff"/><stop offset="1" stop-color="#2cf2b0"/></linearGradient>
   <filter id="blur"><feGaussianBlur stdDeviation="14"/></filter>`);
}

function campus() {
  let windows = '';
  for (let y = 0; y < 5; y++) for (let x = 0; x < 11; x++) {
    windows += `<rect x="${130 + x * 54}" y="${210 + y * 44}" width="46" height="36" fill="${(x + y) % 3 ? '#9fc4e6' : '#6f9fcb'}" opacity=".9"/>`;
  }
  return svg(900, 600, `
    <rect width="900" height="600" fill="url(#sky)"/>
    <ellipse cx="220" cy="110" rx="120" ry="34" fill="#fff" opacity=".8"/><ellipse cx="640" cy="80" rx="150" ry="30" fill="#fff" opacity=".7"/>
    <rect x="90" y="180" width="720" height="260" rx="14" fill="#cfd8e3"/>${windows}
    <text x="450" y="268" text-anchor="middle" font-family="Arial" font-weight="700" font-size="54" fill="#4285f4" opacity=".95">C<tspan fill="#ea4335">a</tspan><tspan fill="#fbbc05">m</tspan><tspan fill="#4285f4">p</tspan><tspan fill="#34a853">u</tspan><tspan fill="#ea4335">s</tspan></text>
    <rect y="440" width="900" height="160" fill="#5e9b52"/>
    <g fill="#3f7a3a"><circle cx="150" cy="470" r="42"/><circle cx="330" cy="500" r="30"/><circle cx="700" cy="480" r="46"/></g>`,
  `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa6ee"/><stop offset="1" stop-color="#cfe6f8"/></linearGradient>`);
}

function nightCity() { // portrait, used as a video poster
  const r = rng(11);
  return svg(720, 1000, `
    <rect width="720" height="1000" fill="url(#bg)"/>
    ${[...Array(34)].map(() => `<circle cx="${r() * 720}" cy="${r() * 620}" r="${8 + r() * 34}" fill="${['#ffd37a', '#ff7aa8', '#7ad7ff'][Math.floor(r() * 3)]}" opacity="${0.12 + r() * 0.3}"/>`).join('')}
    <circle cx="360" cy="430" r="120" fill="#e0b79a"/><path d="M110 1000 C130 700 250 640 360 640 S590 700 610 1000Z" fill="#101114"/>
    <path d="M300 640 L360 760 L420 640Z" fill="#fff"/><path d="M345 700 L375 700 L385 960 L335 960Z" fill="#0a0a0a"/>
    <path d="M250 380 C260 270 460 270 470 380 C430 330 290 330 250 380Z" fill="#17120f"/>`,
  `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0a1f"/><stop offset="1" stop-color="#1c1630"/></linearGradient>`);
}

function dorm() {
  const books = ['#e84a5f', '#2a9d8f', '#f4a261', '#264653', '#e9c46a', '#8ecae6', '#ff7aa8'];
  let b = '';
  books.forEach((c, i) => { b += `<rect x="${170 + i * 34}" y="${250 - (i % 3) * 18}" width="28" height="${96 + (i % 3) * 18}" fill="${c}"/>`; });
  return svg(900, 760, `
    <rect width="900" height="760" fill="#f0d3a8"/><rect y="560" width="900" height="200" fill="#c9a06a"/>
    <rect x="140" y="130" width="380" height="340" fill="#e8892f" stroke="#b9661a" stroke-width="8"/>
    <rect x="160" y="150" width="340" height="150" fill="#f6b266"/>${b}
    <rect x="130" y="470" width="560" height="30" fill="#d9731c"/><rect x="150" y="500" width="30" height="190" fill="#c1630f"/><rect x="640" y="500" width="30" height="190" fill="#c1630f"/>
    <rect x="610" y="260" width="200" height="200" fill="#bfe3f7" stroke="#fff" stroke-width="10"/><path d="M710 260 V460 M610 360 H810" stroke="#fff" stroke-width="8"/>
    <ellipse cx="420" cy="620" rx="90" ry="46" fill="#2f7f86"/>`);
}

function throwback() {
  return svg(640, 820, `
    <rect width="640" height="820" fill="#5b5a4c"/>
    <rect x="24" y="24" width="592" height="772" fill="#6a6858" stroke="#c9c3a8" stroke-width="10"/>
    <circle cx="320" cy="360" r="150" fill="#c79a73"/>
    <path d="M170 330 C180 190 460 190 470 330 C430 270 210 270 170 330Z" fill="#14100d"/>
    <circle cx="270" cy="370" r="10" fill="#222"/><circle cx="370" cy="370" r="10" fill="#222"/><path d="M280 430 Q320 462 360 430" stroke="#6b3e2a" stroke-width="8" fill="none" stroke-linecap="round"/>
    <path d="M100 800 C120 620 230 560 320 560 S520 620 540 800Z" fill="#37506b"/>
    <rect width="640" height="820" fill="#caa86a" opacity=".16"/>`);
}

function sunset() {
  return svg(900, 640, `
    <rect width="900" height="640" fill="url(#s)"/><circle cx="450" cy="380" r="120" fill="#ffe08a"/>
    <path d="M0 400 C150 360 260 420 450 395 S760 350 900 400 V640 H0Z" fill="#7a2f66" opacity=".85"/>
    <path d="M0 470 C200 430 330 500 520 470 S780 440 900 480 V640 H0Z" fill="#40204d"/>
    <rect x="120" y="360" width="30" height="130" fill="#2a1535"/><circle cx="135" cy="345" r="46" fill="#2a1535"/>`,
  `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7e5f"/><stop offset=".6" stop-color="#feb47b"/><stop offset="1" stop-color="#b55a8a"/></linearGradient>`);
}

function avatar(kind, initials) {
  if (kind === 'eunu') {
    return svg(256, 256, `<rect width="256" height="256" fill="url(#g)"/>
      <ellipse cx="90" cy="190" rx="110" ry="34" fill="#ff8fb3" opacity=".55"/><ellipse cx="190" cy="215" rx="90" ry="26" fill="#ffb3c8" opacity=".5"/>
      <circle cx="120" cy="82" r="30" fill="#b9825b"/><circle cx="98" cy="58" r="12" fill="#b9825b"/><circle cx="142" cy="58" r="12" fill="#b9825b"/>
      <rect x="100" y="108" width="40" height="56" rx="14" fill="#8cc8ff"/><circle cx="188" cy="168" r="14" fill="#fff" opacity=".9"/>`,
      `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a2fb5"/><stop offset=".6" stop-color="#c2489b"/><stop offset="1" stop-color="#ef8a7a"/></linearGradient>`);
  }
  return svg(256, 256, `<rect width="256" height="256" fill="#183a37"/><circle cx="128" cy="100" r="46" fill="#e2bc9d"/>
    <path d="M40 256 C50 170 100 150 128 150 S206 170 216 256Z" fill="#0f1a1a"/><path d="M110 150 L128 200 L146 150Z" fill="#fff"/>
    <path d="M84 90 C90 40 166 40 172 90 C150 66 106 66 84 90Z" fill="#111"/>
    <text x="128" y="244" text-anchor="middle" font-family="Arial" font-size="1" fill="none">${initials}</text>`);
}

function ffmpegVideo(file, { w, h, filter, seconds = 4 }) {
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `${filter}=size=${w}x${h}:rate=30`,
      '-t', String(seconds), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', file]);
    return true;
  } catch { return false; }
}

const write = (name, content) => { fs.writeFileSync(path.join(UPLOAD_DIR, name), content); return `/uploads/${name}`; };
const ago = (h) => Date.now() - h * 3600 * 1000;

export function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  console.log('Seeding demo data…');
  const pw = hashPassword('demo1234');
  const addUser = (username, name, bio, av) => Number(db.prepare(
    'INSERT INTO users (username, name, bio, avatar, password_hash, created_at) VALUES (?,?,?,?,?,?)',
  ).run(username, name, bio, av, pw, ago(24 * 30)).lastInsertRowid);

  const eunu = addUser('eunu', 'Eunu Park', 'UK → KR → US\nI guess We did it', write('seed-avatar-eunu.svg', avatar('eunu')));
  const james = addUser('james', 'James Servando', 'Chasing sunsets 🌇', write('seed-avatar-james.svg', avatar('james', 'JS')));

  const addPost = (userId, title, type, media, thumb, w, h, views, hoursAgo) => Number(db.prepare(
    'INSERT INTO posts (user_id, title, type, media, thumb, width, height, views, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(userId, title, type, media, thumb, w, h, views, ago(hoursAgo)).lastInsertRowid);

  const photos = [
    [eunu, 'Throwback', throwback(), 640, 820, 22, 90],
    [eunu, 'Northern lights', aurora(), 900, 560, 41, 70],
    [eunu, 'Campus vibes', campus(), 900, 600, 37, 50],
    [james, 'Golden hour', sunset(), 900, 640, 18, 30],
    [eunu, 'UIUC GO!!', helmet(), 900, 800, 63, 14],
  ];
  const ids = {};
  for (const [uid, title, art, w, h, views, hrs] of photos) {
    ids[title] = addPost(uid, title, 'photo', write(`seed-${title.toLowerCase().replace(/\W+/g, '-')}.svg`, art), null, w, h, views, hrs);
  }

  // videos (need ffmpeg; silently skipped otherwise)
  const vids = [
    ['Dorm room tour', 'testsrc2', 900, 760, 'seed-dorm.mp4', dorm()],
    ['Night out', 'mandelbrot', 720, 1000, 'seed-night.mp4', nightCity()],
  ];
  for (const [title, filter, w, h, file, poster] of vids) {
    if (ffmpegVideo(path.join(UPLOAD_DIR, file), { w, h: h - (h % 2), filter })) {
      addPost(eunu, title, 'video', `/uploads/${file}`, write(file.replace('.mp4', '-poster.svg'), poster), w, h, 28, 40);
    } else console.log(`  (ffmpeg not found – skipped video "${title}")`);
  }

  // the conversation from the design mock-up
  const helmetId = ids['UIUC GO!!'];
  const addComment = (uid, parent, body, hrs) => Number(db.prepare(
    'INSERT INTO comments (post_id, user_id, parent_id, body, created_at) VALUES (?,?,?,?,?)',
  ).run(helmetId, uid, parent, body, ago(hrs)).lastInsertRowid);
  const first = addComment(james, null, 'This shit lit', 14);
  addComment(eunu, first, 'Aww Ty', 14);
  addComment(james, first, 'I really like it', 14);
  addComment(eunu, first, 'Me2 Bro', 14);

  const like = db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?,?)');
  for (const id of Object.values(ids)) like.run(james, id);
  like.run(eunu, ids['Golden hour']);
}

if (process.argv[1] === import.meta.filename) {
  if (process.argv.includes('--reset')) {
    db.exec('DELETE FROM sessions; DELETE FROM likes; DELETE FROM comments; DELETE FROM posts; DELETE FROM users;');
    for (const f of fs.readdirSync(UPLOAD_DIR)) if (f.startsWith('seed-')) fs.unlinkSync(path.join(UPLOAD_DIR, f));
  }
  seedIfEmpty();
  console.log('Done. Demo logins: eunu / demo1234, james / demo1234');
}
