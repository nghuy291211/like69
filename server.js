const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = 'secret_key_tiktok_agency_2026';

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Khởi tạo Database SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Lỗi kết nối CSDL:', err.message);
    } else {
        console.log('Đã kết nối thành công tới CSDL SQLite.');
        initDb();
    }
});

// Tạo bảng & Tài khoản Admin mặc định
function initDb() {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user',
        balance REAL DEFAULT 0
    )`, async (err) => {
        if (err) {
            console.error('Lỗi tạo bảng users:', err.message);
            return;
        }

        // Kiểm tra và tạo tài khoản admin mặc định
        const adminUser = 'nghuy291211';
        const adminPass = 'Huy@122011@';

        db.get('SELECT * FROM users WHERE username = ?', [adminUser], async (err, row) => {
            if (err) console.error('Lỗi kiểm tra Admin:', err.message);
            if (!row) {
                const hashedPassword = await bcrypt.hash(adminPass, 10);
                db.run('INSERT INTO users (username, password, role, balance) VALUES (?, ?, ?, ?)',
                    [adminUser, hashedPassword, 'admin', 10000000],
                    (err) => {
                        if (err) console.error('Lỗi khởi tạo Admin:', err.message);
                        else console.log(`✅ Khởi tạo tài khoản Admin mặc định thành công: ${adminUser}`);
                    }
                );
            }
        });
    });

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        service_name TEXT,
        link TEXT,
        quantity INTEGER,
        total_price REAL,
        status TEXT DEFAULT 'Pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

// API Đăng nhập
app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!' });
        }

        db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
            if (err) {
                console.error('Lỗi Query Login:', err);
                return res.status(500).json({ error: 'Lỗi máy chủ khi truy vấn dữ liệu!' });
            }

            if (!user) {
                return res.status(400).json({ error: 'Tài khoản không tồn tại!' });
            }

            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(400).json({ error: 'Mật khẩu không chính xác!' });
            }

            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.json({
                message: 'Đăng nhập thành công!',
                token,
                role: user.role,
                balance: user.balance
            });
        });
    } catch (error) {
        console.error('Lỗi Server Crash Login:', error);
        res.status(500).json({ error: 'Lỗi máy chủ nội bộ!' });
    }
});

// Middleware xác thực JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Bạn chưa đăng nhập!' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Phiên đăng nhập hết hạn!' });
        req.user = user;
        next();
    });
}

// API Tạo Đơn Hàng
app.post('/api/order', authenticateToken, (req, res) => {
    const { serviceName, link, quantity, pricePerItem } = req.body;
    const userId = req.user.id;
    const totalPrice = quantity * pricePerItem;

    db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return res.status(500).json({ error: 'Lỗi máy chủ!' });

        if (user.balance < totalPrice) {
            return res.status(400).json({ error: 'Số dư tài khoản không đủ để thực hiện giao dịch!' });
        }

        const newBalance = user.balance - totalPrice;
        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId], (err) => {
            if (err) return res.status(500).json({ error: 'Lỗi trừ số dư!' });

            db.run('INSERT INTO orders (user_id, service_name, link, quantity, total_price) VALUES (?, ?, ?, ?, ?)',
                [userId, serviceName, link, quantity, totalPrice],
                function(err) {
                    if (err) return res.status(500).json({ error: 'Lỗi lưu đơn hàng!' });
                    res.json({ message: 'Đặt đơn thành công!', localOrderId: this.lastID, newBalance });
                }
            );
        });
    });
});

// Lắng nghe Port
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
