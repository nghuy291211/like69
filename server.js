const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// API CỦA WEB MẸ (SIEULIKE.COM)
const SIEULIKE_API_URL = 'https://sieulike.com/api/v2';
const SIEULIKE_API_KEY = 'your_sieulike_api_key_here'; // Điền API Key SieuLike của bạn vào đây

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./database.db');

// Khởi tạo DB & Tài khoản Admin mặc định
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        api_key TEXT UNIQUE,
        role TEXT DEFAULT 'user',
        balance REAL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        service_id INTEGER,
        link TEXT,
        quantity INTEGER,
        status TEXT DEFAULT 'Pending'
    )`);

    // Tạo Admin Mặc Định
    const adminUser = 'nghuy291211';
    const adminPass = 'Huy@122011@';
    const adminKey = crypto.randomBytes(16).toString('hex');
    db.run(`INSERT OR IGNORE INTO users (username, password, api_key, role, balance) VALUES (?, ?, ?, 'admin', 10000000)`, 
        [adminUser, adminPass, adminKey]);
});

// API 1: ĐĂNG KÝ TÀI KHOẢN
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin!' });

    const userApiKey = crypto.randomBytes(16).toString('hex');
    db.run(`INSERT INTO users (username, password, api_key, balance) VALUES (?, ?, ?, 0)`,
        [username, password, userApiKey],
        function(err) {
            if (err) return res.status(400).json({ error: 'Tên tài khoản đã tồn tại!' });
            res.json({ message: 'Đăng ký thành công! Bạn có thể đăng nhập ngay.' });
        }
    );
});

// API 2: ĐĂNG NHẬP
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Tài khoản hoặc mật khẩu không đúng!' });
        res.json({
            message: 'Đăng nhập thành công!',
            username: user.username,
            role: user.role,
            balance: user.balance,
            api_key: user.api_key
        });
    });
});

// API 3: QUẢN TRỊ ADMIN - CỘNG TIỀN CHO USER
app.post('/api/admin/add-balance', (req, res) => {
    const { adminUsername, targetUsername, amount } = req.body;

    db.get(`SELECT role FROM users WHERE username = ?`, [adminUsername], (err, admin) => {
        if (err || !admin || admin.role !== 'admin') {
            return res.status(403).json({ error: 'Bạn không có quyền truy cập Quản trị!' });
        }

        db.run(`UPDATE users SET balance = balance + ? WHERE username = ?`, [parseFloat(amount), targetUsername], function(err) {
            if (err || this.changes === 0) return res.status(400).json({ error: 'Không tìm thấy người dùng này!' });
            res.json({ message: `Đã cộng ${amount} VNĐ cho tài khoản ${targetUsername}` });
        });
    });
});

// API 4: BẮT DỊCH VỤ VỀ SIEULIKE.COM (Gọi sang SieuLike API)
app.post('/api/v2', async (req, res) => {
    const { key, action, service, link, quantity } = req.body;

    if (action === 'services') {
        try {
            const params = new URLSearchParams({ key: SIEULIKE_API_KEY, action: 'services' });
            const response = await axios.post(SIEULIKE_API_URL, params);
            return res.json(response.data);
        } catch (e) {
            return res.status(500).json({ error: 'Lỗi lấy danh sách từ server mẹ' });
        }
    }

    if (action === 'add') {
        db.get(`SELECT * FROM users WHERE api_key = ?`, [key], async (err, user) => {
            if (err || !user) return res.status(400).json({ error: 'API Key không hợp lệ!' });

            // Call API tạo đơn sang SieuLike
            try {
                const params = new URLSearchParams({
                    key: SIEULIKE_API_KEY,
                    action: 'add',
                    service: service,
                    link: link,
                    quantity: quantity
                });
                const response = await axios.post(SIEULIKE_API_URL, params);
                
                if (response.data.order) {
                    // Trừ tiền user nội bộ
                    db.run(`UPDATE users SET balance = balance - 1000 WHERE id = ?`, [user.id]);
                }
                return res.json(response.data);
            } catch (e) {
                return res.status(500).json({ error: 'Không thể kết nối đến máy chủ SieuLike' });
            }
        });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
