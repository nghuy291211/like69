const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'views')));

// Helper chuẩn hóa số lẻ tối đa 3 chữ số
function roundMoney(value) {
    const num = Number(value) || 0;
    return Math.round(num * 1000) / 1000;
}

// Cơ sở dữ liệu mô phỏng trong bộ nhớ (In-memory)
let users = [
    { username: 'admin', password: '123', role: 'root_admin', balance: 1000000 },
    { username: 'user1', password: '123', role: 'user', balance: 250000.5 }
];

let services = [
    { service: 101, category: 'TikTok View', name: 'Tăng View TikTok Siêu Tốc', rate: 1.25, min: 1000, max: 1000000 },
    { service: 102, category: 'TikTok View', name: 'Tăng View TikTok Giá Rẻ', rate: 0.85, min: 1000, max: 500000 },
    { service: 201, category: 'TikTok Like', name: 'Tăng Tim TikTok Viễn Đông', rate: 12.5, min: 100, max: 50000 },
    { service: 301, category: 'TikTok Follow', name: 'Tăng Follow TikTok Việt Nam', rate: 45.0, min: 100, max: 20000 }
];

let orders = [];
let balanceChanges = [];

// API 1: Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.status(400).json({ status: 'error', message: 'Tài khoản hoặc mật khẩu không chính xác' });
    }
    res.json({
        status: 'success',
        user: { username: user.username, role: user.role }
    });
});

// API 2: Lấy số dư người dùng
app.get('/api/user/balance', (req, res) => {
    const { username } = req.query;
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
    }

    res.json({
        status: 'success',
        role: user.role,
        usableBalance: roundMoney(user.balance),
        realApiBalance: user.role === 'root_admin' ? roundMoney(user.balance * 1.5) : 0
    });
});

// API 3: Lấy danh sách dịch vụ
app.get('/api/services', (req, res) => {
    const formattedServices = services.map(s => ({
        ...s,
        rate: roundMoney(s.rate)
    }));
    res.json({ status: 'success', data: formattedServices });
});

// API 4: Tạo đơn hàng
app.post('/api/order', (req, res) => {
    const { username, service, link, quantity, price } = req.body;
    const user = users.find(u => u.username === username);

    if (!user) {
        return res.status(400).json({ status: 'error', message: 'Người dùng không hợp lệ' });
    }

    const calculatedCost = roundMoney(price);

    if (user.balance < calculatedCost) {
        return res.status(400).json({ status: 'error', message: 'Số dư không đủ để thực hiện giao dịch' });
    }

    // Trừ tiền & Lưu biến động số dư
    user.balance = roundMoney(user.balance - calculatedCost);
    const orderId = Math.floor(100000 + Math.random() * 900000);

    const sItem = services.find(s => s.service == service);
    const serviceName = sItem ? sItem.name : `Dịch vụ #${service}`;

    orders.unshift({
        id: orderId,
        username: user.username,
        serviceName: serviceName,
        quantity: Number(quantity),
        price: calculatedCost,
        link: link,
        status: 'Completed',
        createdAt: new Date().toLocaleString('vi-VN')
    });

    balanceChanges.unshift({
        username: user.username,
        amount: roundMoney(-calculatedCost),
        lastBalance: user.balance,
        description: `Thanh toán đơn hàng #${orderId}`,
        time: new Date().toLocaleString('vi-VN')
    });

    res.json({
        status: 'success',
        orderId: orderId,
        remainingBalance: user.balance
    });
});

// API 5: Lấy lịch sử đơn hàng
app.get('/api/user/orders', (req, res) => {
    const { username } = req.query;
    const userOrders = orders.filter(o => o.username === username);
    res.json({ status: 'success', data: userOrders });
});

// API 6: Lấy lịch sử biến động số dư
app.get('/api/user/balance-changes', (req, res) => {
    const { username } = req.query;
    const userChanges = balanceChanges.filter(b => b.username === username);
    res.json({ status: 'success', data: userChanges });
});

// Điều hướng trang chính
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server chạy tại: http://localhost:${PORT}`);
});
