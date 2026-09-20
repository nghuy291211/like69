const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://sieulike.com/api/v2";
const API_KEY = process.env.SIEULIKE_API_KEY;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

async function sieulike(params) {
  if (!API_KEY) {
    throw new Error("Chưa cấu hình SIEULIKE_API_KEY trên Render.");
  }

  const body = new URLSearchParams({
    key: API_KEY,
    ...params
  });

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {
      error: text || `HTTP ${response.status}`
    };
  }

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

// Kiểm tra số dư
app.get("/api/balance", async (req, res) => {
  try {
    res.json(await sieulike({
      action: "balance"
    }));
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// Danh sách dịch vụ
app.get("/api/services", async (req, res) => {
  try {
    res.json(await sieulike({
      action: "services"
    }));
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// Kiểm tra trạng thái đơn
app.get("/api/status/:order", async (req, res) => {
  try {
    res.json(await sieulike({
      action: "status",
      order: req.params.order
    }));
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// Render health check
app.get("/health", (req, res) => {
  res.json({
    ok: true
  });
});

// Trang chính
app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
