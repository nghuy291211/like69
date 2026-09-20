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

// ========================================================
// CƠ SỞ DỮ LIỆU TÀI KHOẢN & ĐƠN HÀNG (MEMDB)
// ========================================================
const users = {
    "nghuy291211": {
        username: "nghuy291211",
        password: "Huy@122011@",
        role: "root_admin",
        balance: 0 // Admin gốc dùng số dư trực tiếp từ API
    }
};

const orders = [];

// ========================================================
// ROUTE BẢO MẬT & API
// ========================================================

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

// Lấy thông tin số dư (Tính toán riêng cho Admin gốc và User con)
app.get('/api/user/balance', async (req, res) => {
    const username = req.query.username;
    const user = users[username];

    if (!user) return res.status(404).json({ status: 'error', message: 'User không tồn tại!' });

    if (user.role === 'root_admin') {
        try {
            // 1. Gọi số dư gốc từ API nhà cung cấp
            const params = new URLSearchParams();
            params.append('key', PROVIDER_API_KEY);
            params.append('action', 'balance');

            const apiRes = await axios.post(PROVIDER_API_URL, params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const realApiBalance = parseFloat(apiRes.data.balance || 0);

            // 2. Tính tổng số dư đã gán cho tất cả tài khoản con
            let totalSubUserBalance = 0;
            Object.values(users).forEach(u => {
                if (u.role !== 'root_admin') totalSubUserBalance += u.balance;
            });

            // 3. Số dư khả dụng = Số dư API - Số dư các tài khoản con
            const usableBalance = realApiBalance - totalSubUserBalance;

            return res.json({
                status: 'success',
                role: 'root_admin',
                realApiBalance,
                usableBalance,
                allocatedToSubs: totalSubUserBalance
            });
        } catch (error) {
            return res.status(500).json({ status: 'error', message: 'Lỗi lấy số dư từ API nguồn!' });
        }
    } else {
        // Tài khoản con chỉ lấy số dư được cấp
        return res.json({
            status: 'success',
            role: 'sub_user',
            balance: user.balance
        });
    }
});

// Admin gốc tạo/cập nhật tài khoản con
app.post('/api/admin/manage-user', (req, res) => {
    const { adminUsername, targetUsername, targetPassword, setBalance } = req.body;

    if (users[adminUsername]?.role !== 'root_admin') {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền Admin gốc!' });
    }

    if (!targetUsername) return res.status(400).json({ status: 'error', message: 'Nhập tên tài khoản!' });

    if (!users[targetUsername]) {
        // Tạo mới tài khoản con
        users[targetUsername] = {
            username: targetUsername,
            password: targetPassword || '123456',
            role: 'sub_user',
            balance: parseFloat(setBalance) || 0
        };
    } else {
        // Cập nhật số dư / mật khẩu
        if (setBalance !== undefined && setBalance !== '') users[targetUsername].balance = parseFloat(setBalance);
        if (targetPassword) users[targetUsername].password = targetPassword;
    }

    res.json({ status: 'success', message: `Cập nhật tài khoản ${targetUsername} thành công!`, users });
});

// Danh sách tài khoản (cho Admin)
app.get('/api/admin/users', (req, res) => {
    const adminUsername = req.query.adminUsername;
    if (users[adminUsername]?.role !== 'root_admin') {
        return res.status(403).json({ status: 'error', message: 'Quyền truy cập bị từ chối!' });
    }
    res.json({ status: 'success', users });
});

// Lấy danh sách dịch vụ (Nhóm theo phân loại TikTok)
app.get('/api/services', async (req, res) => {
    try {
        const params = new URLSearchParams();
        params.append('key', PROVIDER_API_KEY);
        params.append('action', 'services');

        const response = await axios.post(PROVIDER_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!Array.isArray(response.data)) return res.status(400).json({ status: 'error', message: 'Lỗi API gốc!' });

        // Lọc và nhóm các dịch vụ TikTok
        const tiktokServices = response.data
            .filter(item => (item.name || '').toLowerCase().includes('tiktok') || (item.category || '').toLowerCase().includes('tiktok'))
            .map(item => ({
                service: item.service,
                name: item.name,
                category: item.category || 'TikTok Tổng Hợp',
                rate: Math.round(parseFloat(item.rate) * PROFIT_MARKUP),
                min: parseInt(item.min) || 50,
                max: parseInt(item.max) || 5000000
            }));

        res.json({ status: 'success', data: tiktokServices });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Không thể kết nối danh sách dịch vụ!' });
    }
});

// Xử lý Đặt Đơn Hàng & Tự động Trừ Số Dư
app.post('/api/order', async (req, res) => {
    try {
        const { username, service, link, quantity, price } = req.body;
        const user = users[username];

        if (!user) return res.status(400).json({ status: 'error', message: 'Tài khoản không hợp lệ!' });

        const orderCost = parseFloat(price);

        // Kiểm tra số dư tài khoản con
        if (user.role !== 'root_admin' && user.balance < orderCost) {
            return res.status(400).json({ status: 'error', message: 'Số dư tài khoản không đủ để đặt đơn này!' });
        }

        // Đẩy đơn qua API c25tool
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

        // Trừ tiền trong ví người dùng nếu là tài khoản con
        if (user.role !== 'root_admin') {
            user.balance -= orderCost;
        }

        res.json({
            status: 'success',
            message: 'Tạo đơn hàng thành công!',
            orderId: apiRes.data.order,
            remainingBalance: user.balance
        });

    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Lỗi hệ thống khi tạo đơn!' });
    }
});

app.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
