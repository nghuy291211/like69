const express = require('express');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'views')));

const PROVIDER_API_URL = process.env.PROVIDER_API_URL || 'https://dichvu.c25tool.net/api/v2';
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || 'c717b*********'; // Thay API Key chuẩn của bạn

function roundMoney(value) {
    const num = Number(value) || 0;
    return Math.round(num);
}

// Lưu trữ bộ nhớ
let users = [
    { username: 'nghuy291211', password: '123', role: 'root_admin', balance: 500000 },
    { username: 'admin', password: '123', role: 'root_admin', balance: 1000000 }
];

let orders = [];
let balanceChanges = [];

// 1. API Lấy Dịch Vụ (Chỉ lọc TikTok)
app.get('/api/services', async (req, res) => {
    try {
        const response = await axios.post(PROVIDER_API_URL, new URLSearchParams({
            key: PROVIDER_API_KEY,
            action: 'services'
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });

        let rawData = response.data;

        if (Array.isArray(rawData)) {
            const tiktokServices = rawData
                .filter(s => {
                    const platform = (s.platform || '').toLowerCase();
                    const category = (s.category || '').toLowerCase();
                    const name = (s.name || '').toLowerCase();
                    return platform.includes('tiktok') || category.includes('tiktok') || name.includes('tiktok');
                })
                .map(s => ({
                    service: s.service,
                    category: s.category || 'TikTok Services',
                    name: s.name,
                    rate: parseFloat(s.rate) || 0,
                    min: parseInt(s.min) || 100,
                    max: parseInt(s.max) || 100000
                }));

            return res.json({ status: 'success', data: tiktokServices });
        } else {
            return res.status(400).json({ status: 'error', message: 'Lỗi API Key hoặc dữ liệu đối tác' });
        }
    } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Không thể kết nối máy chủ API' });
    }
});

// 2. API Lấy Số Dư Chuẩn (Trả về số dư khả dụng thực tế của user)
app.get('/api/user/balance', async (req, res) => {
    const username = req.query.username;
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy tài khoản' });
    }

    let realApiBalance = 0;

    if (user.role === 'root_admin') {
        try {
            const apiRes = await axios.post(PROVIDER_API_URL, new URLSearchParams({
                key: PROVIDER_API_KEY,
                action: 'balance'
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 5000
            });

            if (apiRes.data && apiRes.data.balance !== undefined) {
                let bal = parseFloat(apiRes.data.balance) || 0;
                if (apiRes.data.currency === 'USD') {
                    bal = bal * 25400;
                }
                realApiBalance = bal;
            }
        } catch (err) {
            console.error('Lỗi lấy số dư API:', err.message);
        }
    }

    res.json({
        status: 'success',
        role: user.role,
        usableBalance: roundMoney(user.balance),
        realApiBalance: roundMoney(realApiBalance)
    });
});

// 3. API Admin Cộng/Trừ Tiền Tài Khoản
app.post('/api/admin/adjust-balance', (req, res) => {
    const { adminUsername, targetUsername, amount, type } = req.body;
    const admin = users.find(u => u.username.toLowerCase() === (adminUsername || '').toLowerCase());

    if (!admin || admin.role !== 'root_admin') {
        return res.status(403).json({ status: 'error', message: 'Quyền hạn không hợp lệ' });
    }

    const targetUser = users.find(u => u.username.toLowerCase() === (targetUsername || '').toLowerCase());
    if (!targetUser) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng cần chỉnh sửa' });
    }

    const numAmount = roundMoney(amount);
    if (type === 'add') {
        targetUser.balance += numAmount;
    } else {
        targetUser.balance = Math.max(0, targetUser.balance - numAmount);
    }

    balanceChanges.unshift({
        username: targetUser.username,
        amount: type === 'add' ? numAmount : -numAmount,
        lastBalance: targetUser.balance,
        description: `Admin (${admin.username}) ${type === 'add' ? 'cộng' : 'trừ'} tiền hệ thống`,
        time: new Date().toLocaleString('vi-VN')
    });

    res.json({ status: 'success', message: 'Cập nhật số dư thành công', newBalance: targetUser.balance });
});

// 4. API Đăng Nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase() && u.password === password);
    if (!user) {
        return res.status(400).json({ status: 'error', message: 'Tài khoản hoặc mật khẩu không đúng!' });
    }
    res.json({
        status: 'success',
        user: { username: user.username, role: user.role, balance: roundMoney(user.balance) }
    });
});

// 5. API Đặt Đơn
app.post('/api/order', async (req, res) => {
    const { username, service, link, quantity, price } = req.body;
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) return res.status(400).json({ status: 'error', message: 'Tài khoản không tồn tại' });

    const totalCost = roundMoney(price);
    if (user.balance < totalCost) {
        return res.status(400).json({ status: 'error', message: 'Số dư tài khoản không đủ thanh toán' });
    }

    try {
        const apiOrder = await axios.post(PROVIDER_API_URL, new URLSearchParams({
            key: PROVIDER_API_KEY,
            action: 'add',
            service: service,
            link: link,
            quantity: quantity
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });

        if (apiOrder.data && apiOrder.data.order) {
            user.balance = roundMoney(user.balance - totalCost);
            const orderId = apiOrder.data.order;

            orders.unshift({
                id: orderId,
                username: user.username,
                service: service,
                quantity: quantity,
                price: totalCost,
                link: link,
                createdAt: new Date().toLocaleString('vi-VN')
            });

            balanceChanges.unshift({
                username: user.username,
                amount: -totalCost,
                lastBalance: user.balance,
                description: `Tạo đơn TikTok #${orderId}`,
                time: new Date().toLocaleString('vi-VN')
            });

            return res.json({ status: 'success', orderId: orderId, remainingBalance: user.balance });
        } else {
            return res.status(400).json({ status: 'error', message: apiOrder.data?.error || 'Lỗi xử lý từ hệ thống gốc' });
        }
    } catch (err) {
        return res.status(500).json({ status: 'error', message: 'Lỗi gửi đơn đến nhà cung cấp' });
    }
});

app.get('/api/user/orders', (req, res) => {
    const username = req.query.username;
    res.json({ status: 'success', data: orders.filter(o => o.username.toLowerCase() === (username || '').toLowerCase()) });
});

app.get('/api/user/balance-changes', (req, res) => {
    const username = req.query.username;
    res.json({ status: 'success', data: balanceChanges.filter(b => b.username.toLowerCase() === (username || '').toLowerCase()) });
});

app.get('/api/admin/users', (req, res) => {
    res.json({ status: 'success', data: users.map(u => ({ username: u.username, role: u.role, balance: u.balance })) });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.listen(PORT, () => console.log(`Server chạy tại http://localhost:${PORT}`));
