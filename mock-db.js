// Mock in-memory database for development/testing without MySQL
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

class MockDatabase {
  constructor() {
    this.users = [];
    this.trades = [];
    this.initializeDefaultData();
  }

  initializeDefaultData() {
    // Create default admin user
    const adminPasswordHash = bcrypt.hashSync('admin123', 10);
    this.users.push({
      id: 'admin-001',
      name: 'Admin User',
      email: 'admin@example.com',
      password_hash: adminPasswordHash,
      role: 'admin',
      status: 'approved',
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    });

    // Create default student user
    const studentPasswordHash = bcrypt.hashSync('student123', 10);
    this.users.push({
      id: 'student-001',
      name: 'Student User',
      email: 'student@example.com',
      password_hash: studentPasswordHash,
      role: 'student',
      status: 'approved',
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    });

    // Seed additional demo students with trades
    const demoStudents = [
      { name: 'Alice Trader', email: 'alice@example.com' },
      { name: 'Bob Trader', email: 'bob@example.com' },
      { name: 'Carol Trader', email: 'carol@example.com' },
      { name: 'Dave Trader', email: 'dave@example.com' },
      { name: 'Eve Trader', email: 'eve@example.com' }
    ];

    const assets = ['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD', 'AAPL'];
    const strategies = ['Breakout', 'Pullback', 'Trend follow', 'Reversal', 'Range'];
    const emotions = ['Calm', 'Focused', 'Nervous', 'Confident', 'Tired'];

    const makeTrade = (userId, dayOffset, idx) => {
      const created = new Date();
      created.setDate(created.getDate() - dayOffset);
      const createdAt = created.toISOString().slice(0, 19).replace('T', ' ');

      const asset = assets[idx % assets.length];
      const direction = idx % 2 === 0 ? 'long' : 'short';
      const entry = 100 + idx * 0.5;
      const sl = entry - 0.3;
      const tp = entry + 0.6;
      const exit = direction === 'long' ? entry + (idx % 3 === 0 ? 0.4 : -0.2) : entry - (idx % 3 === 0 ? 0.4 : -0.2);
      const plannedR = (idx % 3) + 1;
      const actualR = Number(((exit - entry) / Math.abs(entry - sl)).toFixed(2));

      return {
        id: randomUUID(),
        userId,
        user_id: userId,
        asset,
        direction,
        entry,
        sl,
        tp,
        exit,
        status: idx % 4 === 0 ? 'reviewed' : 'pending',
        strategy: strategies[idx % strategies.length],
        emotion: emotions[idx % emotions.length],
        planned_r: plannedR,
        actual_r: actualR,
        display_unit: 'pips',
        chart_before_url: null,
        chart_after_url: null,
        reviewed_by: idx % 4 === 0 ? 'coach-001' : null,
        created_at: createdAt,
        updated_at: createdAt
      };
    };

    demoStudents.forEach((s, studentIdx) => {
      const id = `student-${(studentIdx + 2).toString().padStart(3, '0')}`; // start from 002
      const password_hash = bcrypt.hashSync('student123', 10);
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      this.users.push({
        id,
        name: s.name,
        email: s.email,
        password_hash,
        role: 'student',
        status: 'approved',
        created_at: now,
        updated_at: now
      });

      for (let i = 0; i < 20; i++) {
        const trade = makeTrade(id, i, studentIdx * 20 + i);
        this.trades.push(trade);
      }
    });
  }

  // Users
  async findUserByEmail(email) {
    return this.users.find(u => u.email === email);
  }

  async findUserById(id) {
    return this.users.find(u => u.id === id);
  }

  async createUser(userData) {
    this.users.push(userData);
    return userData;
  }

  async getAllUsers() {
    return [...this.users];
  }

  async updateUser(id, updates) {
    const index = this.users.findIndex(u => u.id === id);
    if (index === -1) return null;
    this.users[index] = { ...this.users[index], ...updates };
    return this.users[index];
  }

  async deleteUser(id) {
    const index = this.users.findIndex(u => u.id === id);
    if (index === -1) return false;
    this.users.splice(index, 1);
    return true;
  }

  // Trades
  async findTradeById(id) {
    return this.trades.find(t => t.id === id);
  }

  async getTradeById(id) {
    return this.trades.find(t => t.id === id);
  }

  async getAllTrades() {
    return [...this.trades];
  }

  async getTradesByUserId(userId) {
    return this.trades.filter(t => t.user_id === userId);
  }

  async createTrade(tradeData) {
    this.trades.push(tradeData);
    return tradeData;
  }

  async updateTrade(id, updates) {
    const index = this.trades.findIndex(t => t.id === id);
    if (index === -1) return null;
    this.trades[index] = { ...this.trades[index], ...updates };
    return this.trades[index];
  }

  async deleteTrade(id) {
    const index = this.trades.findIndex(t => t.id === id);
    if (index === -1) return false;
    this.trades.splice(index, 1);
    return true;
  }

  // Utility
  async ping() {
    return true;
  }
}

module.exports = new MockDatabase();
