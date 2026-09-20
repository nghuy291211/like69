try { require('dotenv').config(); } catch (e) {}
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const PROVIDER_API_URL = process.env.PROVIDER_API_URL || 'https://dichvu.c25tool.net/api/v2';
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY;
const PROFIT_MARKUP = parseFloat(process.env.PROFIT_MARKUP) || 1.2;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'views')));

// Cơ sở dữ liệu tài khoản
const users = {
    "nghuy291211": {
        username: "nghuy291211",
        password: "Huy@122011@",
        role: "root_admin",
        balance: 0
    }
};

// Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users[username];

    if (!user || user.password !== password) {
        return res.status(400).json({ status: 'error', message: 'Tài khoản hoặc mật khẩu không chính xác!' });
    }

    res.json({
        status: 'success',
        user: { username: user.username, role: user.role, balance: user.balance }
    });
});

// Lấy danh sách Dịch vụ
app.get('/api/services', async (req, res) => {
    try {
        if (!PROVIDER_API_KEY) {
            return res.status(500).json({ status: 'error', message: 'Chưa cấu hình API Key trên Render!' });
        }

        const params = new URLSearchParams();
        params.append('key', PROVIDER_API_KEY);
        params.append('action', 'services');

        const response = await axios.post(PROVIDER_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!Array.isArray(response.data)) {
            return res.status(400).json({ status: 'error', message: 'Không lấy được danh sách dịch vụ!' });
        }

        const tiktokServices = response.data
            .filter(item => {
                const name = (item.name || '').toLowerCase();
                const category = (item.category || '').toLowerCase();
                return name.includes('tiktok') || category.includes('tiktok');
            })
            .map(item => ({
                service: item.service,
                name: item.name,
                category: item.category || 'TikTok Dịch Vụ',
                rate: parseFloat(item.rate) * PROFIT_MARKUP,
                min: parseInt(item.min) || 50,
                max: parseInt(item.max) || 5000000
            }));

        res.json({ status: 'success', data: tiktokServices });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Lỗi kết nối API nhà cung cấp!' });
    }
});

// Lấy Số dư
app.get('/api/user/balance', async (req, res) => {
    const username = req.query.username;
    const user = users[username];

    if (!user) return res.status(404).json({ status: 'error', message: 'Tài khoản không tồn tại!' });

    if (user.role === 'root_admin') {
        try {
            const params = new URLSearchParams();
            params.append('key', PROVIDER_API_KEY);
            params.append('action', 'balance');

            const apiRes = await axios.post(PROVIDER_API_URL, params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const realApiBalance = parseFloat(apiRes.data.balance || 0);
            let totalSubBalance = 0;
            Object.values(users).forEach(u => {
                if (u.role !== 'root_admin') totalSubBalance += u.balance;
            });

            res.json({
                status: 'success',
                role: 'root_admin',
                realApiBalance,
                usableBalance: realApiBalance - totalSubBalance
            });
        } catch (e) {
            res.status(500).json({ status: 'error', message: 'Lỗi kết nối lấy số dư API!' });
        }
    } else {
        res.json({
            status: 'success',
            role: 'sub_user',
            balance: user.balance
        });
    }
});

// Admin API: Tạo Tài Khoản Con
app.post('/api/admin/create-user', (req, res) => {
    const { adminUsername, newUsername, newPassword, initialBalance } = req.body;

    if (users[adminUsername]?.role !== 'root_admin') {
        return res.status(403).json({ status: 'error', message: 'Quyền truy cập bị từ chối!' });
    }

    if (users[newUsername]) {
        return res.status(400).json({ status: 'error', message: 'Tài khoản này đã tồn tại!' });
    }

    users[newUsername] = {
        username: newUsername,
        password: newPassword || '123456',
        role: 'sub_user',
        balance: parseFloat(initialBalance) || 0
    };

    res.json({ status: 'success', message: `Đã tạo thành công tài khoản ${newUsername}` });
});

// Admin API: Cộng / Cài Số Dư Qua Tên Tài Khoản
app.post('/api/admin/update-balance', (req, res) => {
    const { adminUsername, targetUsername, actionType, amount } = req.body;

    if (users[adminUsername]?.role !== 'root_admin') {
        return res.status(403).json({ status: 'error', message: 'Quyền truy cập bị từ chối!' });
    }

    const targetUser = users[targetUsername];
    if (!targetUser) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy tên tài khoản này!' });
    }

    const numAmount = parseFloat(amount) || 0;

    if (actionType === 'add') {
        targetUser.balance += numAmount; // Cộng thêm tiền
    } else {
        targetUser.balance = numAmount;  // Cài đặt trực tiếp số dư
    }

    res.json({ 
        status: 'success', 
        message: `Đã cập nhật số dư cho ${targetUsername}. Số dư mới: ${targetUser.balance}` 
    });
});

// Xử lý Đặt Đơn
app.post('/api/order', async (req, res) => {
    try {
        const { username, service, link, quantity, price } = req.body;
        const user = users[username];

        if (!user) return res.status(401).json({ status: 'error', message: 'Vui lòng đăng nhập trước!' });

        const orderCost = parseFloat(price);
        if (user.role !== 'root_admin' && user.balance < orderCost) {
            return res.status(400).json({ status: 'error', message: 'Số dư tài khoản không đủ!' });
        }

        const params = new URLSearchParams();
        params.append('key', PROVIDER_API_KEY);
        params.append('action', 'add');
        params.append('service', service);
        params.append('link', link);
        params.append('quantity', quantity);

        const apiRes = await axios.post(PROVIDER_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (apiRes.data.error) {
            return res.status(400).json({ status: 'error', message: apiRes.data.error });
        }

        if (user.role !== 'root_admin') {
            user.balance -= orderCost;
        }

        res.json({
            status: 'success',
            message: 'Tạo đơn hàng thành công!',
            orderId: apiRes.data.order
        });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Lỗi khi tạo đơn hàng!' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
