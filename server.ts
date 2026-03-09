import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database('edge_server.db');

// Ensure storage directory exists
const STORAGE_DIR = path.join(__dirname, 'server_data');
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR);
}

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS file_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER,
    filename TEXT,
    size INTEGER,
    mime_type TEXT,
    category TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(profile_id) REFERENCES profiles(id)
  );

  CREATE TABLE IF NOT EXISTS vault_items (
    id TEXT PRIMARY KEY,
    title TEXT,
    content TEXT,
    type TEXT,
    user_id TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const logs: any[] = [];
const addLog = (method: string, path: string, status: number) => {
  logs.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    method,
    path,
    status
  });
  if (logs.length > 50) logs.pop();
};

async function startServer() {
  const app = express();
  const PORT = 3000; // In this environment, we use 3000

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Middleware for logging
  app.use((req, res, next) => {
    res.on('finish', () => {
      addLog(req.method, req.path, res.statusCode);
    });
    next();
  });

  // --- Profile Management ---
  app.get('/api/profiles', (req, res) => {
    try {
      const profiles = db.prepare('SELECT * FROM profiles').all();
      console.log('GET /api/profiles - Found profiles:', profiles.length);
      res.json(profiles);
    } catch (e) {
      console.error('Error fetching profiles:', e);
      res.status(500).json({ error: 'Failed to fetch profiles' });
    }
  });

  app.post('/api/profiles', (req, res) => {
    const { name, avatar } = req.body;
    console.log('POST /api/profiles called with:', { name, avatar });
    try {
      const stmt = db.prepare('INSERT INTO profiles (name, avatar) VALUES (?, ?)');
      const info = stmt.run(name, avatar || '👤');
      console.log('Profile created in DB:', info);
      res.json({ id: info.lastInsertRowid, name, avatar });
    } catch (e) {
      console.error('Database error creating profile:', e);
      res.status(400).json({ error: 'Profile name already exists or database error' });
    }
  });

  // 1. System Stats (Profile Aware)
  app.get('/api/stats', (req, res) => {
    const profileId = req.query.profileId;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    let storageUsed = 0;
    let profileStorageUsed = 0;

    try {
      const files = fs.readdirSync(STORAGE_DIR);
      files.forEach(file => {
        storageUsed += fs.statSync(path.join(STORAGE_DIR, file)).size;
      });

      if (profileId) {
        const row = db.prepare('SELECT SUM(size) as total FROM file_index WHERE profile_id = ?').get(profileId);
        profileStorageUsed = row.total || 0;
      }
    } catch (e) {}

    res.json({
      ram: {
        used: usedMem,
        total: totalMem,
        free: freeMem
      },
      storage: {
        used: storageUsed,
        profileUsed: profileStorageUsed,
        path: STORAGE_DIR
      },
      uptime: os.uptime(),
      logs: logs.slice(0, 20)
    });
  });

  // 2. Process Data (Partitioned)
  app.post('/api/process', (req, res) => {
    const { data, filename, type, profileId, category } = req.body;

    if (!data || !filename || !profileId) {
      return res.status(400).json({ error: 'Invalid data format. Required: data, filename, profileId' });
    }

    try {
      // Create profile-specific subfolder
      const profileDir = path.join(STORAGE_DIR, `profile_${profileId}`);
      if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir);

      const filePath = path.join(profileDir, filename);
      const buffer = Buffer.from(data, 'base64');
      
      fs.writeFileSync(filePath, buffer);

      // Index in SQLite with category
      const stmt = db.prepare('INSERT INTO file_index (profile_id, filename, size, mime_type, category, metadata) VALUES (?, ?, ?, ?, ?, ?)');
      stmt.run(profileId, filename, buffer.length, type || 'application/octet-stream', category || 'uncategorized', JSON.stringify({ source: 'external_app' }));

      res.json({ 
        success: true, 
        message: 'Data partitioned and indexed successfully',
        fileId: filename 
      });
    } catch (error) {
      console.error('Processing error:', error);
      res.status(500).json({ error: 'Internal processing failure' });
    }
  });

  // 3. List Indexed Files (Filtered by Profile)
  app.get('/api/files', (req, res) => {
    const profileId = req.query.profileId;
    if (!profileId) return res.status(400).json({ error: 'profileId required' });

    const files = db.prepare('SELECT * FROM file_index WHERE profile_id = ? ORDER BY created_at DESC').all(profileId);
    res.json(files);
  });

  // --- Vault Items (Replacing Firestore) ---
  app.get('/api/vault', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    try {
      const items = db.prepare('SELECT * FROM vault_items WHERE user_id = ? ORDER BY created_at DESC').all(userId);
      // Parse tags from string back to array
      const parsedItems = items.map((item: any) => ({
        ...item,
        tags: item.tags ? JSON.parse(item.tags) : [],
        createdAt: item.created_at,
        updatedAt: item.updated_at
      }));
      res.json(parsedItems);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch vault items' });
    }
  });

  app.post('/api/vault', (req, res) => {
    const { id, title, content, type, userId, tags } = req.body;
    if (!id || !userId) return res.status(400).json({ error: 'id and userId required' });

    try {
      const stmt = db.prepare(`
        INSERT INTO vault_items (id, title, content, type, user_id, tags)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, title, content, type, userId, JSON.stringify(tags || []));
      res.json({ success: true });
    } catch (e) {
      console.error('Error creating vault item:', e);
      res.status(500).json({ error: 'Failed to create vault item' });
    }
  });

  app.put('/api/vault/:id', (req, res) => {
    const { id } = req.params;
    const { title, content, type, tags, userId } = req.body;

    try {
      const stmt = db.prepare(`
        UPDATE vault_items 
        SET title = ?, content = ?, type = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `);
      const result = stmt.run(title, content, type, JSON.stringify(tags || []), id, userId);
      if (result.changes === 0) return res.status(404).json({ error: 'Item not found or unauthorized' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to update vault item' });
    }
  });

  app.delete('/api/vault/:id', (req, res) => {
    const { id } = req.params;
    const userId = req.query.userId;

    try {
      const stmt = db.prepare('DELETE FROM vault_items WHERE id = ? AND user_id = ?');
      const result = stmt.run(id, userId);
      if (result.changes === 0) return res.status(404).json({ error: 'Item not found or unauthorized' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete vault item' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Edge Server active on port ${PORT}`);
  });
}

startServer();
