const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'views')));

// Lấy thông tin cấu hình từ biến môi trường
const SMM_API_URL = process.env.API_URL || 'https://dichvu.c25tool.net/api/v2';
const SMM_API_KEY = process.env.API_KEY || '';

const DB_FILE = path.join(__dirname, 'db.json');

function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            users: [
                {
                    username: "admin",
                    password: "123",
                    role: "root_admin",
                    balance: 0,
                    status: "ON"
                }
            ],
            orders: [],
            balanceChanges: []
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// 1. API Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase() && u.password === password);

    if (user) {
        res.json({ status: 'success', user });
    } else {
        res.status(401).json({ status: 'error', message: 'Tài khoản hoặc mật khẩu không chính xác!' });
    }
});

// 2. API Lấy số dư (Đọc từ API gốc dichvu.c25tool.net và tự động tính toán cho Admin)
app.get('/api/user/balance', async (req, res) => {
    const { username } = req.query;
    const db = readDB();
    const user = db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());

    if (!user) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
    }

    let realApiBalance = 0;

    try {
        const response = await axios.post(SMM_API_URL, new URLSearchParams({
            key: SMM_API_KEY,
            action: 'balance'
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (response.data && response.data.balance !== undefined) {
            realApiBalance = parseFloat(response.data.balance);
        }
    } catch (error) {
        console.error("Lỗi gọi API số dư gốc:", error.message);
        realApiBalance = 0;
    }

    let usableBalance = user.balance;

    // Nếu là root_admin: Số dư sử dụng = Tổng tiền từ API - Tổng số dư đã cấp cho các sub-user
    if (user.role === 'root_admin') {
        const totalSubUserBalance = db.users
            .filter(u => u.role !== 'root_admin')
            .reduce((sum, u) => sum + (Number(u.balance) || 0), 0);
        
        usableBalance = realApiBalance - totalSubUserBalance;
    }

    res.json({
        status: 'success',
        usableBalance: usableBalance,
        role: user.role,
        realApiBalance: realApiBalance
    });
});

// 3. API Lấy danh sách dịch vụ từ nguồn gốc
app.get('/api/services', async (req, res) => {
    try {
        const response = await axios.post(SMM_API_URL, new URLSearchParams({
            key: SMM_API_KEY,
            action: 'services'
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        res.json({ status: 'success', data: response.data });
    } catch (error) {
        console.error("Lỗi lấy danh sách dịch vụ:", error.message);
        res.status(500).json({ status: 'error', message: 'Không thể kết nối lấy danh sách dịch vụ từ máy chủ gốc' });
    }
});

// 4. API Tạo đơn hàng
app.post('/api/order', async (req, res) => {
    const { username, service, link, quantity, price } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());

    if (!user) return res.status(404).json({ status: 'error', message: 'Tài khoản không tồn tại' });

    // Tính lại số dư khả dụng của user/admin trước khi check tiền
    let currentUsableBalance = user.balance;
    if (user.role === 'root_admin') {
        const totalSubUserBalance = db.users
            .filter(u => u.role !== 'root_admin')
            .reduce((sum, u) => sum + (Number(u.balance) || 0), 0);
        // Có thể gọi trực tiếp API lấy real balance nếu cần, ở đây check tạm theo số nội bộ hoặc logic hiện tại
        currentUsableBalance = user.balance; // Hoặc check trực tiếp
    }

    if (user.role !== 'root_admin' && user.balance < price) {
        return res.status(400).json({ status: 'error', message: 'Số dư của bạn không đủ để tạo đơn hàng này!' });
    }

    try {
        const orderParams = {
            key: SMM_API_KEY,
            action: 'add',
            service: service,
            link: link,
            quantity: quantity
        };

        const apiResponse = await axios.post(SMM_API_URL, new URLSearchParams(orderParams), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (apiResponse.data && apiResponse.data.order) {
            if (user.role !== 'root_admin') {
                user.balance -= price;
            }

            const newOrder = {
                id: apiResponse.data.order,
                username,
                service,
                link,
                quantity,
                price,
                createdAt: new Date().toLocaleString('vi-VN')
            };

            db.orders.push(newOrder);
            writeDB(db);

            return res.json({ status: 'success', orderId: apiResponse.data.order, message: 'Tạo đơn hàng thành công' });
        } else {
            return res.status(400).json({ status: 'error', message: apiResponse.data.error || 'Lỗi từ hệ thống dịch vụ gốc' });
        }
    } catch (error) {
        console.error("Lỗi tạo đơn:", error.message);
        res.status(500).json({ status: 'error', message: 'Lỗi kết nối máy chủ tạo đơn hàng' });
    }
});

// 5. API Admin tạo tài khoản user mới
app.post('/api/admin/create-user', (req, res) => {
    const { adminUsername, username, password } = req.body;
    const db = readDB();

    const admin = db.users.find(u => u.username.toLowerCase() === String(adminUsername).toLowerCase());
    if (!admin || admin.role !== 'root_admin') {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền thực hiện thao tác này!' });
    }

    if (!username || !password) {
        return res.status(400).json({ status: 'error', message: 'Vui lòng điền đầy đủ thông tin!' });
    }

    const existingUser = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (existingUser) {
        return res.status(400).json({ status: 'error', message: 'Tên tài khoản này đã tồn tại!' });
    }

    const newUser = {
        username: username.trim(),
        password: password.trim(),
        role: 'user',
        balance: 0,
        status: 'ON'
    };

    db.users.push(newUser);
    writeDB(db);

    res.json({ status: 'success', message: `Đã tạo thành công tài khoản: ${username}` });
});

// 6. API Admin cộng trừ tiền
app.post('/api/admin/adjust-balance', (req, res) => {
    const { adminUsername, targetUsername, amount, type } = req.body;
    const db = readDB();

    const admin = db.users.find(u => u.username.toLowerCase() === String(adminUsername).toLowerCase());
    if (!admin || admin.role !== 'root_admin') {
        return res.status(403).json({ status: 'error', message: 'Không có quyền' });
    }

    const targetUser = db.users.find(u => u.username.toLowerCase() === String(targetUsername).toLowerCase());
    if (!targetUser) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy tài khoản thành viên!' });
    }

    const numAmount = Number(amount);
    if (type === 'add') {
        targetUser.balance += numAmount;
    } else if (type === 'subtract') {
        targetUser.balance = Math.max(0, targetUser.balance - numAmount);
    }

    writeDB(db);
    res.json({ status: 'success', message: 'Cập nhật số dư thành công!' });
});

// 7. API Lấy danh sách users cho admin
app.get('/api/admin/users', (req, res) => {
    const { adminUsername } = req.query;
    const db = readDB();
    const admin = db.users.find(u => u.username.toLowerCase() === String(adminUsername).toLowerCase());
    if (!admin || admin.role !== 'root_admin') return res.status(403).json({ status: 'error', message: 'Không có quyền' });
    res.json({ status: 'success', data: db.users });
});

// 8. API Lấy danh sách đơn hàng của user
app.get('/api/user/orders', (req, res) => {
    const { username } = req.query;
    const db = readDB();
    const userOrders = db.orders.filter(o => o.username.toLowerCase() === String(username).toLowerCase());
    res.json({ status: 'success', data: userOrders.reverse() });
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại cổng ${PORT}`);
});
