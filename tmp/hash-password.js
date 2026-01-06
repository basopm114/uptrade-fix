const bcrypt = require('bcryptjs');

const password = 'admin1234';
const hash = bcrypt.hashSync(password, 10);

console.log('Password:', password);
console.log('Hash:', hash);
console.log('\nCopy this INSERT statement and run in TablePlus:\n');
console.log(`INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at) VALUES
('admin-001', 'Admin', 'admin@trader.com', '${hash}', 'admin', 'active', NOW(), NOW());`);
