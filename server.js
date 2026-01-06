const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');
// Load environment variables from server/.env to avoid picking root .env
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// Check if using mock database
const USE_MOCK_DB = process.env.USE_MOCK_DB === 'true' || process.env.NODE_ENV === 'mock';
let mockDb = null;
let pool = null;

if (USE_MOCK_DB) {
  console.log('🔶 Running in MOCK MODE - using in-memory database');
  mockDb = require('./mock-db');
} else {
  // MySQL connection pool with keepalive
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
}

// Middleware
// Allow CORS from configured origins (comma-separated). Default permissive during development.
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors(
    allowedOrigins.length
      ? {
          origin: (origin, callback) => {
            // Allow no origin (same-origin), localhost, Railway domains, or if configured
            if (!origin || origin.startsWith('http://localhost') || origin.includes('railway.app') || allowedOrigins.includes(origin)) {
              return callback(null, true);
            }
            callback(new Error('Not allowed by CORS'));
          },
          credentials: true,
        }
      : undefined
  )
);
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Serve static frontend assets (index.html + assets folder) with proper MIME types
const staticRoot = path.join(__dirname);
app.use(express.static(staticRoot, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html');
    }
  }
}));

// Ensure required columns exist (chart URLs, reviewer) and have safe types
const ensureTradeColumns = async () => {
  if (USE_MOCK_DB) {
    console.log('✅ Mock DB - skipping column checks');
    return;
  }
  
  const connection = await pool.getConnection();
  try {
    const [cols] = await connection.query('SHOW COLUMNS FROM trades');
    const fields = new Map(cols.map((c) => [c.Field, c]));
    const alters = [];

    // Add missing columns with appropriate types
    if (!fields.has('chart_before_url')) {
      alters.push('ADD COLUMN chart_before_url LONGTEXT NULL AFTER display_unit');
    }
    if (!fields.has('chart_after_url')) {
      alters.push('ADD COLUMN chart_after_url LONGTEXT NULL AFTER chart_before_url');
    }
    if (!fields.has('reviewed_by')) {
      alters.push('ADD COLUMN reviewed_by VARCHAR(255) NULL AFTER chart_after_url');
    }

    // Ensure timestamps exist for ordering and auditing
    if (!fields.has('created_at')) {
      alters.push('ADD COLUMN created_at DATETIME NULL');
    }
    if (!fields.has('updated_at')) {
      alters.push('ADD COLUMN updated_at DATETIME NULL');
    }

    // Upgrade existing column types if too small (TEXT → LONGTEXT)
    const beforeCol = fields.get('chart_before_url');
    if (beforeCol && /^(tinytext|text|mediumtext)$/i.test(beforeCol.Type)) {
      alters.push('MODIFY COLUMN chart_before_url LONGTEXT NULL');
    }
    const afterCol = fields.get('chart_after_url');
    if (afterCol && /^(tinytext|text|mediumtext)$/i.test(afterCol.Type)) {
      alters.push('MODIFY COLUMN chart_after_url LONGTEXT NULL');
    }

    if (alters.length > 0) {
      await connection.query(`ALTER TABLE trades ${alters.join(', ')}`);
      console.log('✅ trades table ensured/updated (chart URLs + reviewer columns)');
    }
  } catch (err) {
    console.warn('⚠️ Could not ensure trades columns:', err.message || err.code);
  } finally {
    connection.release();
  }
};

ensureTradeColumns();

// Helper: Generate unique ID
const generateId = () => require('crypto').randomUUID();

// Helper: Generate JWT token
const generateToken = (userId, email, role) => {
  return jwt.sign({ userId, email, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Middleware: Verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ==================== Health Check ====================
app.get('/api/health', async (req, res) => {
  try {
    if (USE_MOCK_DB) {
      await mockDb.ping();
      res.json({ status: 'OK', message: 'Mock database connected', mode: 'MOCK' });
    } else {
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      res.json({ status: 'OK', message: 'Database connected' });
    }
  } catch (error) {
    console.error('DB Error:', error);
    res.status(500).json({ status: 'ERROR', message: error.message || error.code });
  }
});

// ==================== AUTH: Register ====================
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (USE_MOCK_DB) {
    try {
      // Check if user exists
      const existing = await mockDb.findUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user (pending status)
      const userId = generateId();
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await mockDb.createUser({
        id: userId,
        name,
        email,
        password_hash: passwordHash,
        role: 'student',
        status: 'pending',
        created_at: now,
        updated_at: now
      });

      res.json({ message: 'Registration successful. Awaiting admin approval.', userId });
    } catch (error) {
      console.error('Register error:', error);
      res.status(500).json({ error: error.message });
    }
    return;
  }

  const connection = await pool.getConnection();
  try {
    // Check if user exists
    const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user (pending status)
    const userId = generateId();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await connection.query(
      'INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, name, email, passwordHash, 'student', 'pending', now, now]
    );

    res.json({ message: 'Registration successful. Awaiting admin approval.' });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== AUTH: Login ====================
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  if (USE_MOCK_DB) {
    try {
      const user = await mockDb.findUserByEmail(email);

      if (!user) {
        return res.status(401).json({ error: 'ไม่พบบัญชีนี้', code: 'auth/user-not-found' });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง', code: 'auth/wrong-password' });
      }

      // Check if approved
      if (user.status === 'pending') {
        return res.status(403).json({
          status: 'pending',
          error: 'บัญชีของคุณกำลังรอการอนุมัติจาก Admin กรุณารอสักครู่',
          code: 'auth/pending-approval',
          user: { id: user.id, email: user.email, name: user.name },
        });
      }

      // Generate token
      const token = generateToken(user.id, user.email, user.role);

      res.json({
        message: 'เข้าสู่ระบบสำเร็จ',
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง', code: 'auth/server-error' });
    }
    return;
  }

  const connection = await pool.getConnection();
  try {
    const [users] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);

    if (users.length === 0) {
      return res.status(401).json({ error: 'ไม่พบบัญชีนี้', code: 'auth/user-not-found' });
    }

    const user = users[0];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง', code: 'auth/wrong-password' });
    }

    // Check if approved
    if (user.status === 'pending') {
      return res.status(403).json({
        status: 'pending',
        error: 'บัญชีของคุณกำลังรอการอนุมัติจาก Admin กรุณารอสักครู่',
        code: 'auth/pending-approval',
        user: { id: user.id, email: user.email, name: user.name },
      });
    }

    // Generate token
    const token = generateToken(user.id, user.email, user.role);
    res.json({
      status: 'success',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== USERS: Get All ====================
app.get('/api/users', verifyToken, async (req, res) => {
  if (!['admin', 'coach'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or coach only' });
  }

  // Check if pagination is requested
  const usePagination = req.query.page || req.query.limit;

  // Query params for pagination and filtering
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const status = req.query.status; // 'pending', 'active', or undefined for all
  const role = req.query.role; // 'student', 'coach', 'admin', or undefined for all
  const offset = (page - 1) * limit;

  if (USE_MOCK_DB) {
    // Mock mode
    try {
      let users = await mockDb.getAllUsers();
      if (status) {
        users = users.filter(u => u.status === status);
      }
      if (role) {
        users = users.filter(u => u.role === role);
      }
      
      // Backward compatible: return array if no pagination params
      if (!usePagination) {
        return res.json(users);
      }
      
      const total = users.length;
      const paginatedUsers = users.slice(offset, offset + limit);
      return res.json({
        users: paginatedUsers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Real DB mode
  const connection = await pool.getConnection();
  try {
    let base = 'SELECT id, name, email, role, status, created_at FROM users';
    const params = [];
    const conditions = [];

    // Filter by status if provided
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    // Filter by role if provided
    if (role) {
      conditions.push('role = ?');
      params.push(role);
    }

    // Add WHERE clause if we have conditions
    if (conditions.length > 0) {
      const whereClause = ` WHERE ${conditions.join(' AND ')}`;
      base += whereClause;
    }

    // Add ordering
    base += ' ORDER BY created_at DESC';

    // Backward compatible: if no pagination params, return all users as array
    if (!usePagination) {
      const [users] = await connection.query(base, params);
      return res.json(users);
    }

    // With pagination: get count and paginated results
    let countBase = 'SELECT COUNT(*) as total FROM users';
    const countParams = [];
    
    if (status) {
      countParams.push(status);
    }
    if (role) {
      countParams.push(role);
    }
    
    if (conditions.length > 0) {
      countBase += ` WHERE ${conditions.join(' AND ')}`;
    }

    const [countResult] = await connection.query(countBase, countParams);
    const total = countResult[0].total;

    // Add pagination
    base += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [users] = await connection.query(base, params);
    
    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== USERS: Update (Admin: role, status, password reset) ====================
app.patch('/api/users/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { id } = req.params;
  const { role, status, password } = req.body;

  if (USE_MOCK_DB) {
    // Mock mode
    try {
      const updates = {};
      if (role) updates.role = role;
      if (status) updates.status = status;
      if (password) {
        const hash = await bcrypt.hash(password, 10);
        updates.password_hash = hash;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const user = await mockDb.updateUser(id, updates);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({ message: 'User updated successfully' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Real DB mode
  const connection = await pool.getConnection();
  try {
    const updates = [];
    const values = [];

    if (role) {
      updates.push('role = ?');
      values.push(role);
    }
    if (status) {
      updates.push('status = ?');
      values.push(status);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      values.push(hash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString().slice(0, 19).replace('T', ' '));
    values.push(id);

    const [result] = await connection.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== USERS: Delete ====================
app.delete('/api/users/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { id } = req.params;

  if (USE_MOCK_DB) {
    // Mock mode
    try {
      // Delete user's trades first
      const trades = await mockDb.getAllTrades();
      for (const trade of trades.filter(t => t.userId === id)) {
        await mockDb.deleteTrade(trade.id);
      }

      // Delete user
      const deleted = await mockDb.deleteUser(id);
      if (!deleted) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({ message: 'User deleted successfully' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Real DB mode
  const connection = await pool.getConnection();
  try {
    // Delete trades first (cascade)
    await connection.query('DELETE FROM trades WHERE user_id = ?', [id]);

    // Delete user
    const [result] = await connection.query('DELETE FROM users WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== TRADES: Get All (with role filtering + pagination) ====================
app.get('/api/trades', verifyToken, async (req, res) => {
  try {
    // Check if pagination is requested
    const usePagination = req.query.page || req.query.limit;
    
    // Query params for pagination and filtering
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const status = req.query.status; // 'pending', 'reviewed', or undefined for all
    const offset = (page - 1) * limit;

    if (USE_MOCK_DB) {
      // Mock mode
      let trades = await mockDb.getAllTrades();
      if (req.user.role === 'student') {
        trades = trades.filter(t => t.userId === req.user.userId);
      }
      if (status) {
        trades = trades.filter(t => t.status === status);
      }
      
      // Backward compatible: return array if no pagination params
      if (!usePagination) {
        return res.json(trades);
      }
      
      const total = trades.length;
      const paginatedTrades = trades.slice(offset, offset + limit);
      return res.json({
        trades: paginatedTrades,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    }

    // Real DB mode
    const connection = await pool.getConnection();
    try {
      // Determine a safe column to order by
      const [cols] = await connection.query('SHOW COLUMNS FROM trades');
      const columnNames = new Set(cols.map((c) => c.Field));
      const orderCol = columnNames.has('created_at')
        ? 'created_at'
        : columnNames.has('updated_at')
        ? 'updated_at'
        : columnNames.has('id')
        ? 'id'
        : null;

      let base = 'SELECT * FROM trades';
      const params = [];
      const conditions = [];

      // Students see only their trades
      if (req.user.role === 'student') {
        conditions.push('user_id = ?');
        params.push(req.user.userId);
      }

      // Filter by status if provided
      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }

      // Add WHERE clause if we have conditions
      if (conditions.length > 0) {
        const whereClause = ` WHERE ${conditions.join(' AND ')}`;
        base += whereClause;
      }

      // Add ordering
      if (orderCol) {
        base += ` ORDER BY ${orderCol} DESC`;
      }

      // Backward compatible: if no pagination params, return all trades as array
      if (!usePagination) {
        const [trades] = await connection.query(base, params);
        return res.json(trades);
      }

      // With pagination: get count and paginated results
      let countBase = 'SELECT COUNT(*) as total FROM trades';
      const countParams = [];
      
      if (req.user.role === 'student') {
        countParams.push(req.user.userId);
      }
      if (status) {
        countParams.push(status);
      }
      
      if (conditions.length > 0) {
        countBase += ` WHERE ${conditions.join(' AND ')}`;
      }

      const [countResult] = await connection.query(countBase, countParams);
      const total = countResult[0].total;

      // Add pagination
      base += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const [trades] = await connection.query(base, params);
      
      res.json({
        trades,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TRADES: Create ====================
app.post('/api/trades', verifyToken, async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Students only' });
  }

  const {
    asset,
    direction,
    entry,
    sl,
    tp,
    exit: exitPrice,
    status,
    strategy,
    emotion,
    reviewed_by,
  } = req.body;

  // Accept both snake_case and camelCase from frontend
  const planned_r = req.body.planned_r ?? req.body.plannedR ?? null;
  const actual_r = req.body.actual_r ?? req.body.actualR ?? null;
  const display_unit = req.body.display_unit ?? req.body.displayUnit ?? 'pips';
  const chart_before_url = req.body.chart_before_url ?? req.body.chartBeforeUrl ?? null;
  const chart_after_url = req.body.chart_after_url ?? req.body.chartAfterUrl ?? null;

  if (!asset || !direction || !entry || !sl) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (USE_MOCK_DB) {
    // Mock mode
    try {
      const trade = await mockDb.createTrade({
        userId: req.user.userId,
        asset,
        direction,
        entry,
        sl,
        tp: tp || null,
        exit: exitPrice || null,
        status: status || 'pending',
        strategy: strategy || null,
        emotion: emotion || null,
        plannedR: planned_r,
        actualR: actual_r,
        displayUnit: display_unit,
        chartBeforeUrl: chart_before_url,
        chartAfterUrl: chart_after_url,
        reviewedBy: reviewed_by || null
      });
      return res.status(201).json(trade);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Real DB mode
  const connection = await pool.getConnection();
  try {
    const tradeId = generateId();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      await connection.query(
        `INSERT INTO trades (id, user_id, asset, direction, entry, sl, tp, \`exit\`, status, strategy, emotion, planned_r, actual_r, display_unit, chart_before_url, chart_after_url, reviewed_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tradeId,
          req.user.userId,
          asset,
          direction,
          entry,
          sl,
          tp || null,
          exitPrice || null,
          status || 'pending',
          strategy || null,
          emotion || null,
          planned_r,
          actual_r,
          display_unit,
          chart_before_url,
          chart_after_url,
          reviewed_by || null,
          now,
          now,
        ]
      );
    } catch (err) {
      // Backward compatibility if reviewed_by column is missing
      if (err.code === 'ER_BAD_FIELD_ERROR') {
        await connection.query(
          `INSERT INTO trades (id, user_id, asset, direction, entry, sl, tp, \`exit\`, status, strategy, emotion, planned_r, actual_r, display_unit, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tradeId,
            req.user.userId,
            asset,
            direction,
            entry,
            sl,
            tp || null,
            exitPrice || null,
            status || 'pending',
            strategy || null,
            emotion || null,
            planned_r,
            actual_r,
            display_unit,
            now,
            now,
          ]
        );
      } else {
        throw err;
      }
    }

    // Return full trade object with id
    res.status(201).json({
      id: tradeId,
      user_id: req.user.userId,
      asset,
      direction,
      entry,
      sl,
      tp: tp || null,
      exit: exitPrice || null,
      status: status || 'pending',
      strategy: strategy || null,
      emotion: emotion || null,
      planned_r,
      actual_r,
      display_unit,
      chart_before_url,
      chart_after_url,
      reviewed_by: reviewed_by || null,
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== TRADES: Update ====================
app.patch('/api/trades/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (USE_MOCK_DB) {
    // Mock mode
    try {
      const existing = await mockDb.getTradeById(id);
      if (!existing) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      if (req.user.role === 'student' && existing.userId !== req.user.userId) {
        return res.status(403).json({ error: 'Cannot modify other trades' });
      }
      const updated = await mockDb.updateTrade(id, updates);
      return res.json(updated);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Real DB mode
  const connection = await pool.getConnection();
  try {
    // Check ownership (student) or admin
    const [trades] = await connection.query('SELECT user_id FROM trades WHERE id = ?', [id]);
    if (trades.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    if (req.user.role === 'student' && trades[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Cannot modify other trades' });
    }

    const columnMap = {
      userId: 'user_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      plannedR: 'planned_r',
      actualR: 'actual_r',
      displayUnit: 'display_unit',
      exit: '`exit`', // reserved keyword
      date: 'created_at',
      reviewedBy: 'reviewed_by',
      chartBeforeUrl: 'chart_before_url',
      chartAfterUrl: 'chart_after_url',
    };

    // Filter out fields that shouldn't be updated by client
    const blockedFields = ['createdAt', 'created_at', 'updatedAt', 'updated_at', 'userId', 'user_id', 'id', 'date'];
    const filteredUpdates = Object.entries(updates)
      .filter(([key]) => !blockedFields.includes(key))
      .reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});

    let entries = Object.entries(filteredUpdates).map(([key, value]) => {
      const mapped = columnMap[key] || key;
      return { column: mapped, value, originalKey: key };
    });

    if (entries.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const setClause = entries.map((e) => `${e.column} = ?`).join(', ');
    const values = entries.map((e) => e.value);

    try {
      await connection.query(`UPDATE trades SET ${setClause}, updated_at = ? WHERE id = ?`, [
        ...values,
        new Date().toISOString().slice(0, 19).replace('T', ' '),
        id,
      ]);
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') {
        // drop fields that may not exist yet (reviewed_by, chart urls)
        // Note: feedback column should exist after running database-optimization.sql
        const filtered = entries.filter(
          (e) => !['reviewedBy', 'reviewed_by', 'chartBeforeUrl', 'chart_before_url', 'chartAfterUrl', 'chart_after_url'].includes(e.originalKey) &&
                 !['reviewed_by', 'chart_before_url', 'chart_after_url'].includes(e.column)
        );
        const clause = filtered.map((e) => `${e.column} = ?`).join(', ');
        const vals = filtered.map((e) => e.value);
        if (clause.length === 0) return res.status(400).json({ error: 'No fields to update' });
        await connection.query(`UPDATE trades SET ${clause}, updated_at = ? WHERE id = ?`, [
          ...vals,
          new Date().toISOString().slice(0, 19).replace('T', ' '),
          id,
        ]);
      } else {
        throw err;
      }
    }

    res.json({ message: 'Trade updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== TRADES: Delete ====================
app.delete('/api/trades/:id', verifyToken, async (req, res) => {
  const { id } = req.params;

  if (USE_MOCK_DB) {
    // Mock mode
    try {
      const existing = await mockDb.getTradeById(id);
      if (!existing) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      if (req.user.role === 'student' && existing.userId !== req.user.userId) {
        return res.status(403).json({ error: 'Cannot delete other trades' });
      }
      await mockDb.deleteTrade(id);
      return res.json({ message: 'Trade deleted' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Real DB mode
  const connection = await pool.getConnection();
  try {
    // Check ownership
    const [trades] = await connection.query('SELECT user_id FROM trades WHERE id = ?', [id]);
    if (trades.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    if (req.user.role === 'student' && trades[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Cannot delete other trades' });
    }

    await connection.query('DELETE FROM trades WHERE id = ?', [id]);
    res.json({ message: 'Trade deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== ADMIN: Storage Statistics ====================
app.get('/api/admin/storage-stats', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  if (USE_MOCK_DB) {
    return res.json({
      totalImages: 0,
      totalSizeMB: 0,
      imagesWithData: 0,
      message: 'Mock mode - no storage tracking'
    });
  }

  const connection = await pool.getConnection();
  try {
    // Count images and calculate total size
    const [stats] = await connection.query(`
      SELECT 
        COUNT(*) as totalTrades,
        SUM(CASE WHEN chart_before_url IS NOT NULL AND chart_before_url != '' THEN 1 ELSE 0 END) as planImages,
        SUM(CASE WHEN chart_after_url IS NOT NULL AND chart_after_url != '' THEN 1 ELSE 0 END) as resultImages,
        SUM(
          LENGTH(COALESCE(chart_before_url, '')) + 
          LENGTH(COALESCE(chart_after_url, ''))
        ) / 1024 / 1024 as totalSizeMB,
        COUNT(CASE WHEN created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as recentTrades,
        COUNT(CASE WHEN created_at <= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as oldTrades
      FROM trades
    `);

    const result = stats[0];
    const totalImages = (result.planImages || 0) + (result.resultImages || 0);
    
    res.json({
      totalTrades: result.totalTrades || 0,
      totalImages,
      planImages: result.planImages || 0,
      resultImages: result.resultImages || 0,
      totalSizeMB: parseFloat((result.totalSizeMB || 0).toFixed(2)),
      recentTrades: result.recentTrades || 0,
      oldTrades: result.oldTrades || 0,
      retentionDays: 7
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== CRON JOB: Auto-delete old images ====================
if (!USE_MOCK_DB && pool) {
  // Run every day at 3:00 AM (server timezone)
  cron.schedule('0 3 * * *', async () => {
    console.log('🗑️  Running scheduled image cleanup...');
    
    const connection = await pool.getConnection();
    try {
      // Delete images from trades older than 7 days
      const [result] = await connection.query(`
        UPDATE trades 
        SET 
          chart_before_url = NULL,
          chart_after_url = NULL,
          updated_at = NOW()
        WHERE 
          created_at <= DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND (chart_before_url IS NOT NULL OR chart_after_url IS NOT NULL)
      `);
      
      const deletedCount = result.affectedRows || 0;
      console.log(`✅ Deleted images from ${deletedCount} trades older than 7 days`);
      
      // Log stats
      const [stats] = await connection.query(`
        SELECT 
          SUM(LENGTH(COALESCE(chart_before_url, '')) + LENGTH(COALESCE(chart_after_url, ''))) / 1024 / 1024 as currentSizeMB
        FROM trades
      `);
      console.log(`📊 Current storage: ${(stats[0].currentSizeMB || 0).toFixed(2)} MB`);
      
    } catch (error) {
      console.error('❌ Image cleanup failed:', error.message);
    } finally {
      connection.release();
    }
  });
  
  console.log('🕐 Scheduled image cleanup: Every day at 3:00 AM (images older than 7 days)');
}

// Fallback: serve SPA for non-API routes (but not for asset files)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/assets') || req.path.includes('.')) {
    return next();
  }
  res.sendFile(path.join(staticRoot, 'index.html'));
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📊 Database: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
});