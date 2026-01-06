// Wrapper functions for database operations that work with both MySQL and Mock DB

const dbOps = {
  USE_MOCK: false,
  mockDB: null,
  pool: null,

  init(useMock, mockInstance, poolInstance) {
    this.USE_MOCK = useMock;
    this.mockDB = mockInstance;
    this.pool = poolInstance;
  },

  async getConnection() {
    if (this.USE_MOCK) {
      return { 
        query: () => Promise.resolve([[]]), 
        release: () => {}, 
        ping: () => Promise.resolve() 
      };
    }
    return this.pool.getConnection();
  },

  // Users
  async getAllUsers() {
    if (this.USE_MOCK) {
      return this.mockDB.getAllUsers();
    }
    const conn = await this.pool.getConnection();
    try {
      const [users] = await conn.query(
        'SELECT id, name, email, role, status, group_name, starting_balance, created_at FROM users'
      );
      return users;
    } finally {
      conn.release();
    }
  },

  async updateUser(id, updates) {
    if (this.USE_MOCK) {
      return this.mockDB.updateUser(id, { ...updates, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
    }
    const conn = await this.pool.getConnection();
    try {
      const sets = [];
      const values = [];
      Object.entries(updates).forEach(([key, val]) => {
        sets.push(`${key} = ?`);
        values.push(val);
      });
      values.push(new Date().toISOString().slice(0, 19).replace('T', ' '));
      values.push(id);
      await conn.query(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, values);
      return { id, ...updates };
    } finally {
      conn.release();
    }
  },

  async deleteUser(id) {
    if (this.USE_MOCK) {
      return this.mockDB.deleteUser(id);
    }
    const conn = await this.pool.getConnection();
    try {
      await conn.query('DELETE FROM users WHERE id = ?', [id]);
      return true;
    } finally {
      conn.release();
    }
  },

  // Trades
  async getAllTrades() {
    if (this.USE_MOCK) {
      return this.mockDB.getAllTrades();
    }
    const conn = await this.pool.getConnection();
    try {
      const [trades] = await conn.query('SELECT * FROM trades ORDER BY created_at DESC');
      return trades;
    } finally {
      conn.release();
    }
  },

  async createTrade(trade) {
    if (this.USE_MOCK) {
      return this.mockDB.createTrade(trade);
    }
    const conn = await this.pool.getConnection();
    try {
      const cols = Object.keys(trade).join(', ');
      const placeholders = Object.keys(trade).map(() => '?').join(', ');
      const values = Object.values(trade);
      await conn.query(`INSERT INTO trades (${cols}) VALUES (${placeholders})`, values);
      return trade;
    } finally {
      conn.release();
    }
  },

  async updateTrade(id, updates) {
    if (this.USE_MOCK) {
      return this.mockDB.updateTrade(id, { ...updates, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
    }
    const conn = await this.pool.getConnection();
    try {
      const sets = [];
      const values = [];
      Object.entries(updates).forEach(([key, val]) => {
        sets.push(`${key} = ?`);
        values.push(val);
      });
      values.push(new Date().toISOString().slice(0, 19).replace('T', ' '));
      values.push(id);
      await conn.query(`UPDATE trades SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, values);
      return { id, ...updates };
    } finally {
      conn.release();
    }
  },

  async deleteTrade(id) {
    if (this.USE_MOCK) {
      return this.mockDB.deleteTrade(id);
    }
    const conn = await this.pool.getConnection();
    try {
      await conn.query('DELETE FROM trades WHERE id = ?', [id]);
      return true;
    } finally {
      conn.release();
    }
  },

  async findTradeById(id) {
    if (this.USE_MOCK) {
      return this.mockDB.findTradeById(id);
    }
    const conn = await this.pool.getConnection();
    try {
      const [trades] = await conn.query('SELECT * FROM trades WHERE id = ?', [id]);
      return trades[0] || null;
    } finally {
      conn.release();
    }
  }
};

module.exports = dbOps;
