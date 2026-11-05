'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const publicDirectory = path.join(__dirname, 'public');
const dataDirectory = path.join(__dirname, 'data');
const databasePath = path.join(dataDirectory, 'qaf-blog.json');
const sessionCookie = 'qaf_session';
const sessionDuration = 24 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
let storeQueue = Promise.resolve();

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(JSON.stringify(value));
}

function readCookie(request, name) {
  const cookies = request.headers.cookie || '';
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return '';
}

function cookieHeader(value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${sessionCookie}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

async function readBody(request, maxBytes = 32 * 1024) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    const error = new Error('Gunakan Content-Type application/json.');
    error.status = 415;
    throw error;
  }

  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) {
      const error = new Error('Ukuran permintaan terlalu besar.');
      error.status = 413;
      throw error;
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Format JSON tidak valid.');
    error.status = 400;
    throw error;
  }
}

async function readDatabase() {
  try {
    const database = JSON.parse(await fs.readFile(databasePath, 'utf8'));
    if (!Array.isArray(database.users) || !Array.isArray(database.posts)) {
      throw new Error('Database QAF tidak memiliki format yang benar.');
    }
    return database;
  } catch (error) {
    if (error.code === 'ENOENT') return { users: [], posts: [] };
    throw error;
  }
}

async function updateDatabase(update) {
  let release;
  const previous = storeQueue;
  storeQueue = new Promise((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    const database = await readDatabase();
    const result = await update(database);
    await fs.mkdir(dataDirectory, { recursive: true });
    const temporaryPath = `${databasePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(database, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, databasePath);
    return result;
  } finally {
    release();
  }
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName || user.email.split('@')[0],
    bio: user.bio || '',
    avatar: user.avatar || null
  };
}

function validProfileAvatar(avatar) {
  if (avatar === null) return true;
  if (typeof avatar !== 'string') return false;

  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatar);
  if (!match) return false;

  const data = Buffer.from(match[2], 'base64');
  if (data.length === 0 || data.length > 2 * 1024 * 1024 || data.toString('base64') !== match[2]) return false;
  if (match[1] === 'image/png') {
    return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (match[1] === 'image/jpeg') {
    return data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  }
  return data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP';
}

function sessionUser(request) {
  const token = readCookie(request, sessionCookie);
  if (!token) return null;
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const session = sessions.get(key);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return null;
  }
  return session.user;
}

function issueSession(response, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const key = crypto.createHash('sha256').update(token).digest('hex');
  sessions.set(key, { user: userId, expiresAt: Date.now() + sessionDuration });
  response.setHeader('Set-Cookie', cookieHeader(token, sessionDuration / 1000));
}

function takeLoginAttempt(request) {
  const ip = request.socket.remoteAddress || 'unknown';
  const current = loginAttempts.get(ip);
  const now = Date.now();
  if (!current || current.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= 10;
}

async function api(request, response, pathname) {
  if (request.method === 'POST' && pathname === '/api/register') {
    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!validEmail(email)) return sendJson(response, 400, { error: 'Masukkan alamat email yang valid.' });
    if (Buffer.byteLength(password, 'utf8') < 10 || Buffer.byteLength(password, 'utf8') > 128) {
      return sendJson(response, 400, { error: 'Kata sandi harus sepanjang 10–128 byte.' });
    }

    const user = await updateDatabase(async (database) => {
      if (database.users.some((item) => item.email === email)) return null;
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = await scrypt(password, salt, 64);
      const created = {
        id: crypto.randomUUID(),
        email,
        salt,
        passwordHash: passwordHash.toString('hex'),
        displayName: email.split('@')[0],
        bio: ''
      };
      database.users.push(created);
      return publicUser(created);
    });
    if (!user) return sendJson(response, 409, { error: 'Email ini sudah terdaftar. Silakan masuk.' });
    issueSession(response, user.id);
    return sendJson(response, 201, { user });
  }

  if (request.method === 'POST' && pathname === '/api/login') {
    if (!takeLoginAttempt(request)) {
      return sendJson(response, 429, { error: 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.' });
    }
    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const database = await readDatabase();
    const user = database.users.find((item) => item.email === email);
    const salt = user?.salt || 'qaf-invalid-user-salt';
    const expectedHash = user?.passwordHash || '0'.repeat(128);
    const actualHash = await scrypt(password, salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    const valid = user && expected.length === actualHash.length && crypto.timingSafeEqual(actualHash, expected);
    if (!valid) return sendJson(response, 401, { error: 'Email atau kata sandi salah.' });
    issueSession(response, user.id);
    return sendJson(response, 200, { user: publicUser(user) });
  }

  if (request.method === 'POST' && pathname === '/api/logout') {
    const token = readCookie(request, sessionCookie);
    if (token) sessions.delete(crypto.createHash('sha256').update(token).digest('hex'));
    response.setHeader('Set-Cookie', cookieHeader('', 0));
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === 'GET' && pathname === '/api/me') {
    const userId = sessionUser(request);
    if (!userId) return sendJson(response, 200, { user: null });
    const database = await readDatabase();
    const user = database.users.find((item) => item.id === userId);
    if (!user) return sendJson(response, 200, { user: null });
    return sendJson(response, 200, { user: publicUser(user) });
  }

  if (request.method === 'PATCH' && pathname === '/api/profile') {
    const userId = sessionUser(request);
    if (!userId) return sendJson(response, 401, { error: 'Silakan masuk terlebih dahulu.' });

    const body = await readBody(request, 3 * 1024 * 1024);
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const bio = typeof body.bio === 'string' ? body.bio.trim() : '';
    const avatar = Object.hasOwn(body, 'avatar') ? body.avatar : undefined;
    if (!displayName || displayName.length > 80) {
      return sendJson(response, 400, { error: 'Nama tampilan wajib diisi (maksimal 80 karakter).' });
    }
    if (bio.length > 300) {
      return sendJson(response, 400, { error: 'Bio maksimal 300 karakter.' });
    }
    if (avatar !== undefined && !validProfileAvatar(avatar)) {
      return sendJson(response, 400, { error: 'Foto profil harus berupa PNG, JPEG, atau WebP maksimal 2 MB.' });
    }

    const user = await updateDatabase((database) => {
      const account = database.users.find((item) => item.id === userId);
      if (!account) return null;
      account.displayName = displayName;
      account.bio = bio;
      if (avatar !== undefined) account.avatar = avatar;
      return publicUser(account);
    });
    if (!user) return sendJson(response, 401, { error: 'Akun tidak ditemukan. Silakan masuk kembali.' });
    return sendJson(response, 200, { user });
  }

  if (pathname === '/api/posts') {
    const userId = sessionUser(request);
    if (!userId) return sendJson(response, 401, { error: 'Silakan masuk terlebih dahulu.' });

    if (request.method === 'GET') {
      const database = await readDatabase();
      const posts = database.posts
        .filter((post) => post.userId === userId)
        .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
        .map(({ id, title, category, content, createdAt }) => ({ id, title, category, content, createdAt }));
      return sendJson(response, 200, { posts });
    }

    if (request.method === 'POST') {
      const body = await readBody(request);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      const category = body.category;
      if (!title || title.length > 120) {
        return sendJson(response, 400, { error: 'Judul wajib diisi (maksimal 120 karakter).' });
      }
      if (!content || content.length > 10000) {
        return sendJson(response, 400, { error: 'Isi wajib diisi (maksimal 10.000 karakter).' });
      }
      if (!['Kajian', 'Aksi', 'Tentang QAF'].includes(category)) {
        return sendJson(response, 400, { error: 'Kategori tulisan tidak valid.' });
      }
      const post = {
        id: crypto.randomUUID(),
        userId,
        title,
        category,
        content,
        createdAt: new Date().toISOString()
      };
      await updateDatabase((database) => {
        database.posts.push(post);
      });
      const { userId: ownerId, ...publicPost } = post;
      return sendJson(response, 201, { post: publicPost });
    }
  }

  return sendJson(response, 404, { error: 'Endpoint tidak ditemukan.' });
}

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');

  try {
    const url = new URL(request.url, `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      await api(request, response, url.pathname);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    if (!['/', '/index.html', '/login', '/login.html', '/styles.css', '/app.js'].includes(url.pathname)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Halaman tidak ditemukan.');
      return;
    }
    const fileName = url.pathname === '/' || url.pathname === '/index.html'
      ? 'index.html'
      : url.pathname === '/login'
        ? 'login.html'
        : url.pathname.slice(1);
    const filePath = path.join(publicDirectory, fileName);
    const contentTypes = {
      'index.html': 'text/html; charset=utf-8',
      'login.html': 'text/html; charset=utf-8',
      'styles.css': 'text/css; charset=utf-8',
      'app.js': 'text/javascript; charset=utf-8'
    };
    const content = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': contentTypes[fileName], 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, error.status || 500, {
        error: error.status ? error.message : 'Terjadi kesalahan pada server.'
      });
    } else {
      response.destroy();
    }
  }
});

server.listen(port, host, () => {
  console.log(`QAF Blog berjalan di http://${host}:${port}`);
});
