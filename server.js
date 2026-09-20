const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// API URL từ ảnh của bạn
const API_URL = 'https://dichvu.c25tool.net/api/v2'; //[span_3](start_span)[span_3](end_span)

// Middleware giải mã dữ liệu form
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Phục vụ giao diện HTML
app.use(express.static(path.join(__dirname, 'views')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Endpoint xử lý đặt đơn hàng
app.post('/api/create-order', async (req, res) => {
    try {
        const { apiKey, service, link, quantity, runs, interval } = req.body;

        if (!apiKey || !service || !link || !quantity) {
            return res.status(400).json({ status: 'error', message: 'Vui lòng điền đầy đủ các thông tin bắt buộc!' });
        }

        // Tạo dữ liệu form urlencoded theo chuẩn SMM Panel v2[span_4](start_span)[span_4](end_span)
        const params = new URLSearchParams();
        params.append('key', apiKey);
        params.append('action', 'add');
        params.append('service', service);
        params.append('link', link);
        params.append('quantity', quantity);

        if (runs) params.append('runs', runs);
        if (interval) params.append('interval', interval);

        // Gửi request POST[span_5](start_span)[span_5](end_span)
        const response = await axios.post(API_URL, params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded' //[span_6](start_span)[span_6](end_span)
            }
        });

        res.json({ status: 'success', data: response.data });
    } catch (error) {
        console.error('Lỗi khi gửi order:', error.message);
        res.status(500).json({
            status: 'error',
            message: error.response ? error.response.data : error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
