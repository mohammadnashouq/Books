// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, createRateLimiter, SESSION_COOKIE } from './app.js';
import { openDatabase } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';

const FAST = { N: 1024, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const T0 = '2026-01-01T00:00:00.000Z';

function book(id, extra = {}) {
  return {
    id,
    title: 'Lantern',
    genre: 'Fantasy',
    status: 'draft',
    goal: 1000,
    color: 'violet',
    createdAt: T0,
    updatedAt: T0,
    chapters: [
      { id: 'c1', title: 'One', text: 'Once upon a time' },
      { id: 'c2', title: 'Two', text: 'The end' },
    ],
    comments: [
      { id: 'm1', chapterId: 'c2', author: 'You', text: 'Private note', quote: '', resolved: false, createdAt: T0 },
    ],
    ...extra,
  };
}

let db;
let app;

beforeEach(() => {
  db = openDatabase(':memory:');
  app = createApp({ db, passwordParams: FAST });
});

/** A supertest agent keeps cookies between requests, like a browser. */
async function signedIn(username = 'writer', password = 'correct horse') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').set('X-Books-Client', '1').send({ username, password });
  expect(res.status).toBe(201);
  return agent;
}

const put = (agent, b, baseRevision = null) =>
  agent.put(`/api/me/books/${b.id}`).set('X-Books-Client', '1').send({ book: b, baseRevision });

describe('passwords', () => {
  it('hashes with a salt and verifies', async () => {
    const a = await hashPassword('secret-pass', FAST);
    const b = await hashPassword('secret-pass', FAST);
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(await verifyPassword('secret-pass', a)).toBe(true);
    expect(await verifyPassword('wrong-pass', a)).toBe(false);
    expect(await verifyPassword('secret-pass', 'garbage')).toBe(false);
  });
});

describe('accounts', () => {
  it('registers with only a username and password, and signs in', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/register')
      .set('X-Books-Client', '1')
      .send({ username: 'Maya', password: 'long enough' });
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: expect.any(Number), username: 'Maya' });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    expect((await agent.get('/api/auth/me')).body.user.username).toBe('Maya');
  });

  it('stores a password hash, never the password', async () => {
    await signedIn('maya', 'my secret words');
    const row = db.prepare('SELECT password_hash FROM users').get();
    expect(row.password_hash).not.toContain('my secret words');
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
  });

  it('rejects bad usernames and short passwords', async () => {
    const send = (body) => request(app).post('/api/auth/register').set('X-Books-Client', '1').send(body);
    expect((await send({ username: 'ab', password: 'long enough' })).status).toBe(400);
    expect((await send({ username: 'has space', password: 'long enough' })).status).toBe(400);
    expect((await send({ username: 'maya', password: 'short' })).status).toBe(400);
    expect((await send({ username: 'maya' })).status).toBe(400);
  });

  it('treats usernames case-insensitively', async () => {
    await signedIn('Maya');
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Books-Client', '1')
      .send({ username: 'maya', password: 'long enough' });
    expect(res.status).toBe(409);

    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Books-Client', '1')
      .send({ username: 'MAYA', password: 'correct horse' });
    expect(login.status).toBe(200);
    expect(login.body.user.username).toBe('Maya');
  });

  it('gives the same answer for an unknown user and a wrong password', async () => {
    await signedIn('maya');
    const login = (username, password) =>
      request(app).post('/api/auth/login').set('X-Books-Client', '1').send({ username, password });
    const unknown = await login('nobody', 'whatever123');
    const wrong = await login('maya', 'whatever123');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('signs out and the old cookie stops working', async () => {
    const agent = await signedIn();
    const cookie = (await agent.get('/api/auth/me')).request.cookies;
    expect((await agent.post('/api/auth/logout').set('X-Books-Client', '1')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
    // Replaying the old token is rejected too: the session is deleted server-side.
    const replay = await request(app).get('/api/me/books').set('Cookie', cookie);
    expect(replay.status).toBe(401);
  });

  it('expires sessions', async () => {
    const agent = await signedIn();
    db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
  });

  it('rate-limits repeated login attempts', async () => {
    await signedIn('maya');
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await request(app)
        .post('/api/auth/login')
        .set('X-Books-Client', '1')
        .send({ username: 'maya', password: `wrong-${i}-pass` });
    }
    expect(last.status).toBe(429);
  });
});

describe('cross-site protection', () => {
  it('refuses state changes without the client header', async () => {
    const agent = await signedIn();
    const res = await agent.put('/api/me/books/b1').send({ book: book('b1'), baseRevision: null });
    expect(res.status).toBe(403);
    const reg = await request(app).post('/api/auth/register').send({ username: 'other', password: 'long enough' });
    expect(reg.status).toBe(403);
  });

  it('ignores a malformed cookie from another app on the same host', async () => {
    const agent = await signedIn('maya');
    const session = (await agent.get('/api/auth/me')).request.cookies;
    const res = await request(app).get('/api/auth/me').set('Cookie', `x=%; other=%zz; ${session}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('maya');
    expect((await request(app).get('/api/books').set('Cookie', 'x=%')).status).toBe(200);
  });

  it('sends security headers', async () => {
    const res = await request(app).get('/api/books');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('books', () => {
  it('saves a book with its chapters and comments, and reads it back', async () => {
    const agent = await signedIn();
    const res = await put(agent, book('b1'));
    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(1);

    const own = await agent.get('/api/me/books');
    expect(own.body.books).toEqual([{ ...book('b1'), revision: 1 }]);
    expect(db.prepare('SELECT COUNT(*) n FROM chapters').get().n).toBe(2);
    expect(db.prepare('SELECT COUNT(*) n FROM comments').get().n).toBe(1);
  });

  it('lets everyone read every book, but keeps comments private to the owner', async () => {
    const owner = await signedIn('owner');
    await put(owner, book('b1'));

    const list = await request(app).get('/api/books');
    expect(list.body.books).toEqual([
      expect.objectContaining({ id: 'b1', title: 'Lantern', owner: 'owner', chapterCount: 2, words: 6 }),
    ]);
    expect(list.body.books[0].chapters).toBeUndefined();

    const visitor = await request(app).get('/api/books/b1');
    expect(visitor.status).toBe(200);
    expect(visitor.body.book.chapters.map((c) => c.text)).toEqual(['Once upon a time', 'The end']);
    expect(visitor.body.book.comments).toBeUndefined();
    expect(visitor.body.book.isOwner).toBe(false);

    const otherUser = await signedIn('reader');
    expect((await otherUser.get('/api/books/b1')).body.book.comments).toBeUndefined();

    const mine = await owner.get('/api/books/b1');
    expect(mine.body.book.isOwner).toBe(true);
    expect(mine.body.book.comments).toHaveLength(1);
  });

  it('only lets the owner change or delete a book', async () => {
    const owner = await signedIn('owner');
    await put(owner, book('b1'));
    const other = await signedIn('intruder');

    expect((await put(other, book('b1', { title: 'Mine now' }), 1)).status).toBe(403);
    expect((await other.delete('/api/me/books/b1?baseRevision=1').set('X-Books-Client', '1')).status).toBe(403);
    expect((await request(app).put('/api/me/books/b1').set('X-Books-Client', '1').send({ book: book('b1') })).status).toBe(
      401,
    );
    expect((await request(app).get('/api/books/b1')).body.book.title).toBe('Lantern');
    expect((await other.get('/api/me/books')).body.books).toEqual([]);
  });

  it('detects a stale save and returns the current book', async () => {
    const agent = await signedIn();
    await put(agent, book('b1'));
    expect((await put(agent, book('b1', { title: 'Second' }), 1)).body.revision).toBe(2);

    const stale = await put(agent, book('b1', { title: 'From an old tab' }), 1);
    expect(stale.status).toBe(409);
    expect(stale.body.current).toMatchObject({ title: 'Second', revision: 2 });
  });

  it('refuses to delete a book that changed since the client saw it', async () => {
    const agent = await signedIn();
    await put(agent, book('b1'));
    await put(agent, book('b1', { title: 'Edited elsewhere' }), 1);
    const res = await agent.delete('/api/me/books/b1?baseRevision=1').set('X-Books-Client', '1');
    expect(res.status).toBe(409);
    const ok = await agent.delete('/api/me/books/b1?baseRevision=2').set('X-Books-Client', '1');
    expect(ok.status).toBe(204);
    expect(db.prepare('SELECT COUNT(*) n FROM chapters').get().n).toBe(0);
  });

  it('rejects malformed books without touching the stored one', async () => {
    const agent = await signedIn();
    await put(agent, book('b1'));
    const bad = [
      book('b1', { title: '' }),
      book('b1', { status: 'weird' }),
      book('b1', { chapters: [] }),
      book('b1', { comments: [{ id: 'x', chapterId: 'missing', author: 'You', text: 'hi', resolved: false, createdAt: T0 }] }),
      book('b1', { comments: [{ id: 'x', chapterId: 'c1', author: ' ', text: 'hi', resolved: false, createdAt: T0 }] }),
      book('b1', { updatedAt: '1 Jan 2020' }),
      book('other-id'),
    ];
    for (const b of bad) {
      const res = await agent.put('/api/me/books/b1').set('X-Books-Client', '1').send({ book: b, baseRevision: 1 });
      expect(res.status).toBe(400);
    }
    expect((await agent.get('/api/me/books')).body.books[0].revision).toBe(1);
  });

  it('answers invalid JSON with 400', async () => {
    const agent = await signedIn();
    const res = await agent
      .put('/api/me/books/b1')
      .set('X-Books-Client', '1')
      .set('Content-Type', 'application/json')
      .send('{nope');
    expect(res.status).toBe(400);
  });
});

describe('rate limiter', () => {
  it('allows `limit` hits per window', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')]).toEqual([true, true, false]);
    expect(limiter.hit('b')).toBe(true);
    t = 1000;
    expect(limiter.hit('a')).toBe(true);
  });
});
