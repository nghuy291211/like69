const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // Nếu bạn gọi API bên thứ 3

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'views')));

// File database giả lập (Lưu dữ liệu vào db.json)
const DB_FILE = path.join(__dirname, 'db.json');

// Khởi tạo database mặc định nếu chưa có
function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            users: [
                {
                    username: "nghuy291211",
                    password: "Huy@122011@",
                    role: "root_admin",
                    balance: 1000000,
                    status: "ON",
                    ip: "127.0.0.1",
                    lastActive: "Vừa xong"
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
    const user = db.users.find(u => u.username === username && u.password === password);

    if (user) {
        user.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        user.lastActive = new Date().toLocaleString('vi-VN');
        writeDB(db);
        res.json({ status: 'success', user });
    } else {
        res.status(401).json({ status: 'error', message: 'Tài khoản hoặc mật khẩu không chính xác!' });
    }
});

// 2. API Lấy số dư user
app.get('/api/user/balance', (req, res) => {
    const { username } = req.query;
    const db = readDB();
    const user = db.users.find(u => u.username === username);

    if (user) {
        res.json({
            status: 'success',
            usableBalance: user.balance,
            role: user.role,
            realApiBalance: 5000000 // Thay số dư API thực tế của bạn vào đây nếu có
        });
    } else {
        res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
    }
});

// 3. API Lấy danh sách dịch vụ (Mock hoặc gọi API dịch vụ sapa/sostt...)
app.get('/api/services', async (req, res) => {
    try {
        // Ví dụ dữ liệu danh sách dịch vụ TikTok mẫu
        const mockServices = [
            { service: 101, category: "TikTok Like", name: "Buff Like TikTok (Server 1)", rate: 15000, min: 100, max: 50000 },
            { service: 102, category: "TikTok Follow", name: "Buff Follow TikTok (Server 2)", rate: 50000, min: 200, max: 20000 },
            { service: 103, category: "TikTok View", name: "Buff View TikTok (Kháng Bot)", rate: 2000, min: 1000, max: 500000 }
        ];
        res.json({ status: 'success', data: mockServices });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Lỗi lấy danh sách dịch vụ' });
    }
});

// ==========================================
// 4. API QUAN TRỌNG: ADMIN TẠO TÀI KHOẢN USER
// ==========================================
app.post('/api/admin/create-user', (req, res) => {
    const { adminUsername, username, password } = req.body;
    const db = readDB();

    // Kiểm tra quyền root_admin
    const admin = db.users.find(u => u.username === adminUsername);
    if (!admin || admin.role !== 'root_admin') {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền thực hiện thao tác này!' });
    }

    if (!username || !password) {
        return res.status(400).json({ status: 'error', message: 'Vui lòng điền đầy đủ thông tin!' });
    }

    // Kiểm tra trùng tên tài khoản
    const existingUser = db.users.find(u => u.username === username);
    if (existingUser) {
        return res.status(400).json({ status: 'error', message: 'Tên tài khoản này đã tồn tại trong hệ thống!' });
    }

    // Tạo user mới
    const newUser = {
        username: username.trim(),
        password: password.trim(),
        role: 'user',
        balance: 0,
        status: 'ON',
        ip: 'Chưa đăng nhập',
        lastActive: 'Chưa hoạt động'
    };

    db.users.push(newUser);
    writeDB(db);

    res.json({ status: 'success', message: `Đã tạo thành công tài khoản: ${username}` });
});

// 5. API Lấy danh sách user cho Admin
app.get('/api/admin/users', (req, res) => {
    const { adminUsername } = req.query;
    const db = readDB();
    const admin = db.users.find(u => u.username === adminUsername);

    if (!admin || admin.role !== 'root_admin') {
        return res.status(403).json({ status: 'error', message: 'Không có quyền truy cập' });
    }

    res.json({ status: 'success', data: db.users });
});

// 6. API Cộng trừ tiền thành viên
app.post('/api/admin/adjust-balance', (req, res) => {
    const { adminUsername, targetUsername, amount, type } = req.body;
    const db = readDB();

    const admin = db.users.find(u => u.username === adminUsername);
    if (!admin || admin.role !== 'root_admin') {
        return res.status(403).json({ status: 'error', message: 'Không có quyền' });
    }

    const targetUser = db.users.find(u => u.username === targetUsername);
    if (!targetUser) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy tài khoản thành viên này!' });
    }

    const numAmount = Number(amount);
    if (type === 'add') {
        targetUser.balance += numAmount;
    } else if (type === 'subtract') {
        targetUser.balance = Math.max(0, targetUser.balance - numAmount);
    }

    // Ghi lại biến động số dư
    db.balanceChanges.push({
        username: targetUsername,
        description: `Admin ${type === 'add' ? 'cộng' : 'trừ'} ${numAmount.toLocaleString()} đ`,
        amount: type === 'add' ? numAmount : -numAmount,
        lastBalance: targetUser.balance,
        time: new Date().toLocaleString('vi-VN')
    });

    writeDB(db);
    res.json({ status: 'success', message: 'Cập nhật số dư thành công!' });
});

// 7. API Tạo đơn hàng
app.post('/api/order', (req, res) => {
    const { username, service, link, quantity, price } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username);

    if (!user) return res.status(404).json({ status: 'error', message: 'Tài khoản không tồn tại' });

    if (user.balance < price) {
        return res.status(400).json({ status: 'error', message: 'Số dư của bạn không đủ để tạo đơn hàng này!' });
    }

    user.balance -= price;

    const newOrder = {
        id: Date.now(),
        username,
        service,
        link,
        quantity,
        price,
        createdAt: new Date().toLocaleString('vi-VN')
    };

    db.orders.push(newOrder);
    writeDB(db);

    res.json({ status: 'success', orderId: newOrder.id, message: 'Tạo đơn hàng thành công' });
});

// 8. API Lấy lịch sử đơn hàng
app.get('/api/user/orders', (req, res) => {
    const { username } = req.query;
    const db = readDB();
    const userOrders = db.orders.filter(o => o.username === username);
    res.json({ status: 'success', data: userOrders.reverse() });
});

// 9. API Lấy biến động số dư
app.get('/api/user/balance-changes', (req, res) => {
    const { username } = req.query;
    const db = readDB();
    const changes = db.balanceChanges.filter(c => c.username === username);
    res.json({ status: 'success', data: changes.reverse() });
});

// 10. API Cập nhật profile cá nhân
app.post('/api/user/update-profile', (req, res) => {
    const { currentUsername, newUsername, newPassword } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === currentUsername);

    if (!user) return res.status(404).json({ status: 'error', message: 'Không tìm thấy user' });

    if (newUsername && newUsername !== currentUsername) {
        const checkExist = db.users.find(u => u.username === newUsername);
        if (checkExist) return res.status(400).json({ status: 'error', message: 'Tên đăng nhập mới đã tồn tại!' });
        user.username = newUsername;
    }

    if (newPassword && newPassword.trim() !== '') {
        user.password = newPassword.trim();
    }

    writeDB(db);
    res.json({ status: 'success', message: 'Cập nhật thông tin thành công!', user });
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại cổng ${PORT}`);
});
