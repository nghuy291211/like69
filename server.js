const express = require('express');
const path = require('path');
const axios = require('axios'); // Thêm thư viện axios để gọi API bên ngoài
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'views')));

// CONFIG API NHÀ CUNG CẤP GỐC
const PROVIDER_API_URL = 'https://provider-domain.com/api/v2'; // Thay URL API của bạn
const PROVIDER_API_KEY = 'YOUR_API_KEY_HERE';                 // Thay API Key của bạn

function roundMoney(value) {
    const num = Number(value) || 0;
    return Math.round(num * 1000) / 1000;
}

let users = [
    { username: 'nghuy291211', password: '123', role: 'root_admin', balance: 500000 },
    { username: 'admin', password: '123', role: 'root_admin', balance: 1000000 }
];

let orders = [];
let balanceChanges = [];

// 1. API Lấy danh sách dịch vụ TRỰC TIẾP từ Nhà Cung Cấp
app.get('/api/services', async (req, res) => {
    try {
        // Gọi API nhà cung cấp
        const response = await axios.post(PROVIDER_API_URL, new URLSearchParams({
            key: PROVIDER_API_KEY,
            action: 'services'
        }));

        // Trả về danh sách dịch vụ từ API gốc
        res.json({
            status: 'success',
            data: response.data
        });
    } catch (error) {
        console.error('Lỗi kết nối API dịch vụ:', error.message);
        res.status(500).json({ status: 'error', message: 'Không thể kết nối đến nhà cung cấp dịch vụ!' });
    }
});

// 2. API Lấy Số Dư
app.get('/api/user/balance', async (req, res) => {
    const username = req.query.username;
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
    }

    let realApiBalance = 0;

    // Nếu là Admin, gọi số dư thực tế từ tài khoản Nhà Cung Cấp
    if (user.role === 'root_admin') {
        try {
            const apiRes = await axios.post(PROVIDER_API_URL, new URLSearchParams({
                key: PROVIDER_API_KEY,
                action: 'balance'
            }));
            realApiBalance = apiRes.data.balance || 0;
        } catch (err) {
            console.error('Lỗi lấy số dư API gốc:', err.message);
        }
    }

    res.json({
        status: 'success',
        role: user.role,
        usableBalance: roundMoney(user.balance),
        realApiBalance: roundMoney(realApiBalance)
    });
});

// 3. API Đăng nhập
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

// 4. API Bắn đơn TRỰC TIẾP lên Nhà Cung Cấp
app.post('/api/order', async (req, res) => {
    const { username, service, link, quantity, price } = req.body;
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) return res.status(400).json({ status: 'error', message: 'Người dùng không hợp lệ' });

    const totalCost = roundMoney(price);
    if (user.balance < totalCost) {
        return res.status(400).json({ status: 'error', message: 'Số dư không đủ thanh toán' });
    }

    try {
        // Gửi order sang API đối tác
        const apiOrder = await axios.post(PROVIDER_API_URL, new URLSearchParams({
            key: PROVIDER_API_KEY,
            action: 'add',
            service: service,
            link: link,
            quantity: quantity
        }));

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
                amount: roundMoney(-totalCost),
                lastBalance: user.balance,
                description: `Thanh toán đơn hàng API #${orderId}`,
                time: new Date().toLocaleString('vi-VN')
            });

            res.json({ status: 'success', orderId: orderId, remainingBalance: user.balance });
        } else {
            res.status(400).json({ status: 'error', message: apiOrder.data.error || 'Lỗi từ nhà cung cấp API' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Không thể kết nối đến máy chủ đối tác' });
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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
