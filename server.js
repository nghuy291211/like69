require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình từ Biến Môi Trường (Render Environment Variables)
const PROVIDER_API_URL = process.env.PROVIDER_API_URL || 'https://dichvu.c25tool.net/api/v2';
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY;

// Tỷ lệ tăng giá bán lại của bạn (Ví dụ: 1.2 tức là lời 20% so với giá gốc)
const PROFIT_MARKUP = parseFloat(process.env.PROFIT_MARKUP) || 1.2;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'views')));

// ========================================================
// API 1: LẤY DANH SÁCH DỊCH VỤ TIKTOK TRỰC TIẾP TỪ C25TOOL
// ================================================= structure
app.get('/api/services', async (req, res) => {
    try {
        if (!PROVIDER_API_KEY) {
            return res.status(500).json({ status: 'error', message: 'Chưa cấu hình PROVIDER_API_KEY trên Render!' });
        }

        // Gọi action 'services' để lấy toàn bộ danh sách dịch vụ gốc
        const params = new URLSearchParams();
        params.append('key', PROVIDER_API_KEY);
        params.append('action', 'services');

        const response = await axios.post(PROVIDER_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!Array.isArray(response.data)) {
            return res.status(400).json({ status: 'error', message: 'Không thể lấy danh sách dịch vụ từ nhà cung cấp!' });
        }

        // Lọc chỉ lấy các dịch vụ TikTok và nhân tỷ lệ lợi nhuận
        const tiktokServices = response.data
            .filter(item => {
                const name = (item.name || '').toLowerCase();
                const category = (item.category || '').toLowerCase();
                return name.includes('tiktok') || category.includes('tiktok');
            })
            .map(item => {
                const originalRate = parseFloat(item.rate);
                const sellingRate = Math.round(originalRate * PROFIT_MARKUP); // Giá bạn bán cho khách

                return {
                    service: item.service,            // ID dịch vụ thực tế
                    name: item.name,                  // Tên dịch vụ
                    category: item.category,          // Danh mục
                    rate: sellingRate,                // Giá bán lại (Đã cộng lời)
                    min: parseInt(item.min) || 100,    // Số lượng tối thiểu
                    max: parseInt(item.max) || 100000  // Số lượng tối đa
                };
            });

        res.json({ status: 'success', data: tiktokServices });

    } catch (error) {
        console.error("Lỗi lấy danh sách dịch vụ:", error.message);
        res.status(500).json({ status: 'error', message: 'Lỗi kết nối tới nhà cung cấp dịch vụ!' });
    }
});

// ========================================================
// API 2: ĐẶT ĐƠN HÀNG THỰC TẾ SANG C25TOOL
// ========================================================
app.post('/api/order', async (req, res) => {
    try {
        const { service, link, quantity } = req.body;

        if (!service || !link || !quantity) {
            return res.status(400).json({ status: 'error', message: 'Vui lòng nhập đầy đủ Dịch vụ, Link và Số lượng!' });
        }

        if (!PROVIDER_API_KEY) {
            return res.status(500).json({ status: 'error', message: 'Chưa cấu hình API Key hệ thống!' });
        }

        // Gửi request trực tiếp sang SMM Panel gốc
        const params = new URLSearchParams();
        params.append('key', PROVIDER_API_KEY);
        params.append('action', 'add');
        params.append('service', service);
        params.append('link', link);
        params.append('quantity', quantity);

        const apiRes = await axios.post(PROVIDER_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // Xử lý phản hồi từ nhà cung cấp
        if (apiRes.data.error) {
            return res.status(400).json({ status: 'error', message: apiRes.data.error });
        }

        if (apiRes.data.order) {
            return res.json({
                status: 'success',
                message: 'Tạo đơn thành công!',
                orderId: apiRes.data.order // ID đơn hàng tạo thành công bên c25tool
            });
        }

        res.status(400).json({ status: 'error', message: 'Tạo đơn không thành công. Vui lòng kiểm tra lại thông tin!' });

    } catch (error) {
        console.error("Lỗi đặt đơn:", error.message);
        res.status(500).json({ status: 'error', message: 'Lỗi kết nối máy chủ API!' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.listen(PORT, () => console.log(`Server live tại port ${PORT}`));
