-- ========================================
-- DATABASE OPTIMIZATION SCRIPT
-- Run these commands in TablePlus to improve performance
-- ========================================

-- 1. Add feedback column to trades table
ALTER TABLE trades 
ADD COLUMN feedback TEXT NULL;

-- 2. Create indexes for faster queries on trades table
-- Index on user_id (for filtering trades by user)
CREATE INDEX idx_trades_user_id ON trades(user_id);

-- Index on status (for filtering by pending/reviewed)
CREATE INDEX idx_trades_status ON trades(status);

-- Index on created_at (for sorting by date)
CREATE INDEX idx_trades_created_at ON trades(created_at DESC);

-- Composite index for common queries (user + status)
CREATE INDEX idx_trades_user_status ON trades(user_id, status);

-- 3. Create indexes for users table
-- Index on status (for filtering pending users)
CREATE INDEX idx_users_status ON users(status);

-- Index on role (for filtering by student/coach/admin)
CREATE INDEX idx_users_role ON users(role);

-- Index on created_at (for sorting)
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- Composite index for filtering by role and status
CREATE INDEX idx_users_role_status ON users(role, status);

-- ========================================
-- Verification queries (run after creating indexes)
-- ========================================

-- Check indexes on trades table
SHOW INDEX FROM trades;

-- Check indexes on users table
SHOW INDEX FROM users;

-- Test query performance (should be much faster now)
EXPLAIN SELECT * FROM trades WHERE user_id = 'some-user-id' ORDER BY created_at DESC LIMIT 50;
EXPLAIN SELECT * FROM users WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50;
