const express = require('express');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'views')));

// THÔNG TIN API TỪ DICHVU.C25TOOL.NET
const PROVIDER_API_URL = process.env.PROVIDER_API_URL || 'https://dichvu.c25tool.net/api/v2';
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || 'c717b*********'; // Thay API Key thực tế của bạn tại đây

// Tỉ giá USD -> VND để quy đổi số dư API nếu API trả về USD
const USD_TO_VND_RATE = 25400; 

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

// 1. API Lấy danh sách dịch vụ trực tiếp từ dichvu.c25tool.net
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
            // Chuẩn hóa dữ liệu trả về từ dichvu.c25tool.net
            const formattedServices = rawData.map(s => {
                let rateNumber = parseFloat(s.rate) || 0;
                
                // Nếu giá rate trong API gốc là USD (ví dụ 0.5/1k) thì đổi ra VND
                if (rateNumber < 10) { 
                    rateNumber = rateNumber * USD_TO_VND_RATE;
                }

                return {
                    service: s.service,
                    category: s.category || 'Dịch vụ Tổng Hợp',
                    name: s.name || 'Dịch vụ',
                    rate: rateNumber, // Ép về số nguyên/thực VND
                    min: parseInt(s.min) || 100,
                    max: parseInt(s.max) || 100000
                };
            });

            return res.json({ status: 'success', data: formattedServices });
        } else {
            return res.status(400).json({ status: 'error', message: 'API Key không chính xác hoặc lỗi từ c25tool' });
        }
    } catch (error) {
        console.error('Lỗi kết nối API dichvu.c25tool.net:', error.message);
        return res.status(500).json({ status: 'error', message: 'Không thể kết nối API nhà cung cấp' });
    }
});

// 2. API Lấy Số Dư thực tế
app.get('/api/user/balance', async (req, res) => {
    const username = req.query.username;
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
    }

    let realApiBalanceVND = 0;

    if (user.role === 'root_admin') {
        try {
            const apiRes = await axios.post(PROVIDER_API_URL, new URLSearchParams({
                key: PROVIDER_API_KEY,
                action: 'balance'
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 5000
            });

            if (apiRes.data && apiRes.data.balance) {
                const balanceVal = parseFloat(apiRes.data.balance) || 0;
                
                // Nếu đơn vị là USD, quy đổi ra VND để hiển thị chuẩn trên web
                if (apiRes.data.currency === 'USD') {
                    realApiBalanceVND = balanceVal * USD_TO_VND_RATE;
                } else {
                    realApiBalanceVND = balanceVal;
                }
            }
        } catch (err) {
            console.error('Lỗi lấy số dư c25tool:', err.message);
        }
    }

    res.json({
        status: 'success',
        role: user.role,
        usableBalance: roundMoney(user.balance),
        realApiBalance: roundMoney(realApiBalanceVND)
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

// 4. API Tạo đơn hàng
app.post('/api/order', async (req, res) => {
    const { username, service, link, quantity, price } = req.body;
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) return res.status(400).json({ status: 'error', message: 'Người dùng không hợp lệ' });

    const totalCost = roundMoney(price);
    if (user.balance < totalCost) {
        return res.status(400).json({ status: 'error', message: 'Số dư không đủ thanh toán' });
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
                amount: roundMoney(-totalCost),
                lastBalance: user.balance,
                description: `Thanh toán đơn hàng API #${orderId}`,
                time: new Date().toLocaleString('vi-VN')
            });

            return res.json({ status: 'success', orderId: orderId, remainingBalance: user.balance });
        } else {
            return res.status(400).json({ status: 'error', message: apiOrder.data?.error || 'Lỗi từ nhà cung cấp API' });
        }
    } catch (err) {
        return res.status(500).json({ status: 'error', message: 'Không thể gửi đơn sang API c25tool' });
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
