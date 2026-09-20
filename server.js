const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = "https://sieulike.com/api/v2";
const API_KEY = process.env.SIEULIKE_API_KEY;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// API SIEULIKE
// =========================
async function callSieulike(params) {
  if (!API_KEY) {
    return {
      error: "Chưa cấu hình SIEULIKE_API_KEY trên Render"
    };
  }

  const body = new URLSearchParams();

  body.set("key", API_KEY);

  for (const [key, value] of Object.entries(params)) {
    body.set(key, String(value));
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: body.toString()
  });

  const text = await response.text();

  console.log("Sieulike HTTP:", response.status);
  console.log("Sieulike response:", text.substring(0, 500));

  try {
    return JSON.parse(text);
  } catch {
    return {
      error: "API Sieulike không trả JSON",
      http_status: response.status,
      response: text.substring(0, 500)
    };
  }
}

// =========================
// HEALTH
// =========================
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    server: "running"
  });
});

// =========================
// BALANCE
// =========================
app.get("/api/balance", async (req, res) => {
  try {
    const data = await callSieulike({
      action: "balance"
    });

    res.json(data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

// =========================
// SERVICES
// =========================
app.get("/api/services", async (req, res) => {
  try {
    const data = await callSieulike({
      action: "services"
    });

    res.json(data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

// =========================
// STATUS
// =========================
app.get("/api/status/:order", async (req, res) => {
  try {
    const data = await callSieulike({
      action: "status",
      order: req.params.order
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// =========================
// STATIC WEBSITE
// =========================
app.use(express.static(path.join(__dirname, "public")));

// =========================
// API 404
// =========================
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint không tồn tại"
  });
});

// =========================
// WEBSITE FALLBACK
// =========================
app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// =========================
// START
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
