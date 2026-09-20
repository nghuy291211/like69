require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';
const API_KEY_SIEULIKE = process.env.API_KEY_SIEULIKE;
const API_BASE_URL = process.env.API_BASE_URL || 'https://sieulike.com/api';

// Kết nối CSDL PostgreSQL (Tự động thích ứng cấu hình của Render)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Khởi tạo bảng dữ liệu và tài khoản Admin mặc định
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance NUMERIC(15, 2) DEFAULT 0,
                role VARCHAR(10) DEFAULT 'user'
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                api_order_id VARCHAR(100),
                service_type VARCHAR(100),
                target TEXT,
                quantity INTEGER,
                price NUMERIC(15, 2),
                status VARCHAR(50) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Tạo tài khoản Admin mặc định nếu chưa tồn tại (admin / admin123)
        const adminCheck = await pool.query(`SELECT * FROM users WHERE username = 'admin'`);
        if (adminCheck.rows.length === 0) {
            const hash = await bcrypt.hash('admin123', 10);
            await pool.query(
                `INSERT INTO users (username, password, balance, role) VALUES ($1, $2, $3, $4)`,
                ['admin', hash, 1000000, 'admin']
            );
            console.log('-> Đã tạo tài khoản Admin mặc định: admin / admin123');
        }
    } catch (err) {
        console.error('Lỗi khởi tạo CSDL:', err.message);
    }
};

initDB();

// Middleware xác thực JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token không hợp lệ' });
        req.user = user;
        next();
    });
};

// Middleware kiểm tra quyền Admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Admin mới có quyền thực hiện chức năng này' });
    }
    next();
};

// ---------------- API ENDPOINTS ----------------

// 1. Đăng nhập
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: 'Tài khoản hoặc mật khẩu không chính xác' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, role: user.role, balance: parseFloat(user.balance) });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
});

// 2. Admin tạo tài khoản người dùng
app.post('/api/admin/create-user', authenticateToken, isAdmin, async (req, res) => {
    const { username, password, initial_balance, role } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const userRole = role || 'user';
        const balance = initial_balance || 0;

        const result = await pool.query(
            `INSERT INTO users (username, password, balance, role) VALUES ($1, $2, $3, $4) RETURNING id`,
            [username, hashedPassword, balance, userRole]
        );
        res.json({ message: 'Tạo tài khoản thành công', userId: result.rows[0].id });
    } catch (err) {
        res.status(400).json({ error: 'Tên tài khoản đã tồn tại hoặc dữ liệu không hợp lệ' });
    }
});

// 3. Admin cộng/trừ tiền số dư
app.post('/api/admin/update-balance', authenticateToken, isAdmin, async (req, res) => {
    const { userId, amount } = req.body;
    try {
        await pool.query(`UPDATE users SET balance = balance + $1 WHERE id = $2`, [amount, userId]);
        res.json({ message: 'Cập nhật số dư thành công' });
    } catch (err) {
        res.status(500).json({ error: 'Không thể cập nhật số dư' });
    }
});

// 4. Tạo đơn hàng TikTok
app.post('/api/order', authenticateToken, async (req, res) => {
    const { service, link, quantity, pricePerItem } = req.body;
    const totalPrice = quantity * pricePerItem;

    try {
        const userRes = await pool.query(`SELECT balance FROM users WHERE id = $1`, [req.user.id]);
        const balance = parseFloat(userRes.rows[0].balance);

        if (balance < totalPrice) {
            return res.status(400).json({ error: 'Số dư không đủ để thực hiện giao dịch' });
        }

        // Gọi API sang Sieulike.com
        const apiRes = await axios.post(`${API_BASE_URL}`, {
            key: API_KEY_SIEULIKE,
            action: 'add',
            service: service,
            link: link,
            quantity: quantity
        });

        if (apiRes.data && apiRes.data.order) {
            const apiOrderId = apiRes.data.order;

            // Trừ tiền & tạo đơn nội bộ
            await pool.query(`UPDATE users SET balance = balance - $1 WHERE id = $2`, [totalPrice, req.user.id]);
            const orderRes = await pool.query(
                `INSERT INTO orders (user_id, api_order_id, service_type, target, quantity, price, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [req.user.id, apiOrderId, service, link, quantity, totalPrice, 'Processing']
            );

            return res.json({ message: 'Đặt đơn thành công', localOrderId: orderRes.rows[0].id, apiOrderId });
        } else {
            return res.status(500).json({ error: 'Lỗi từ nhà cung cấp API', details: apiRes.data });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Không thể kết nối đến server API gốc' });
    }
});

// 5. Kiểm tra tiến độ đơn hàng
app.get('/api/order/status/:orderId', authenticateToken, async (req, res) => {
    const localOrderId = req.params.orderId;

    try {
        const orderRes = await pool.query(`SELECT * FROM orders WHERE id = $1 AND user_id = $2`, [localOrderId, req.user.id]);
        const order = orderRes.rows[0];

        if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

        // Gọi API lấy trạng thái
        const apiRes = await axios.post(`${API_BASE_URL}`, {
            key: API_KEY_SIEULIKE,
            action: 'status',
            order: order.api_order_id
        });

        const currentStatus = apiRes.data.status || 'Unknown';
        const remains = apiRes.data.remains || 0;

        await pool.query(`UPDATE orders SET status = $1 WHERE id = $2`, [currentStatus, localOrderId]);

        res.json({
            localOrderId: order.id,
            apiOrderId: order.api_order_id,
            status: currentStatus,
            remains: remains,
            price: order.price
        });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi cập nhật tiến độ' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
          
