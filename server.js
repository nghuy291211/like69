const express = require("express");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

const API_URL =
    process.env.SIEULIKE_API_URL || "https://sieulike.com/api/v2";

const API_KEY =
    process.env.SIEULIKE_API_KEY || "";

const ADMIN_USERNAME =
    process.env.ADMIN_USERNAME || "nghuy291211";

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || "CHANGE_THIS_PASSWORD";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database(
    path.join(__dirname, "database.db")
);

// ======================================================
// DATABASE
// ======================================================

db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            api_key TEXT UNIQUE NOT NULL,
            role TEXT DEFAULT 'user',
            balance REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            service_id TEXT NOT NULL,
            service_name TEXT,
            link TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL DEFAULT 0,
            total REAL DEFAULT 0,
            provider_order_id TEXT,
            status TEXT DEFAULT 'Pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            balance_before REAL NOT NULL,
            balance_after REAL NOT NULL,
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.get(
        `SELECT id FROM users WHERE username = ?`,
        [ADMIN_USERNAME],
        (err, row) => {

            if (err) {
                console.error(err);
                return;
            }

            if (!row) {

                const apiKey = crypto
                    .randomBytes(32)
                    .toString("hex");

                db.run(
                    `
                    INSERT INTO users
                    (username,password,api_key,role,balance)
                    VALUES (?,?,?,?,?)
                    `,
                    [
                        ADMIN_USERNAME,
                        ADMIN_PASSWORD,
                        apiKey,
                        "admin",
                        0
                    ],
                    (e) => {
                        if (e) {
                            console.error(
                                "Không tạo được admin:",
                                e.message
                            );
                        } else {
                            console.log(
                                "Đã tạo tài khoản admin:",
                                ADMIN_USERNAME
                            );
                        }
                    }
                );
            }
        }
    );
});

// ======================================================
// HELPER
// ======================================================

function hashPassword(password) {
    return crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");
}

function generateApiKey() {
    return crypto
        .randomBytes(32)
        .toString("hex");
}

function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

async function providerRequest(params) {

    if (!API_KEY) {
        throw new Error(
            "Chưa cấu hình SIEULIKE_API_KEY"
        );
    }

    const body = new URLSearchParams();

    body.append("key", API_KEY);

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            body.append(key, String(value));
        }
    });

    const response = await axios.post(
        API_URL,
        body.toString(),
        {
            timeout: 30000,
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded"
            }
        }
    );

    return response.data;
}

// ======================================================
// HEALTH
// ======================================================

app.get("/api/health", (req, res) => {

    res.json({
        ok: true,
        api_configured: Boolean(API_KEY),
        time: new Date().toISOString()
    });

});

// ======================================================
// REGISTER
// ======================================================

app.post("/api/register", (req, res) => {

    const username =
        String(req.body.username || "").trim();

    const password =
        String(req.body.password || "");

    if (!username || !password) {
        return res.status(400).json({
            error: "Vui lòng nhập đầy đủ thông tin!"
        });
    }

    if (username.length < 3) {
        return res.status(400).json({
            error: "Tên tài khoản phải có ít nhất 3 ký tự."
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            error: "Mật khẩu phải có ít nhất 6 ký tự."
        });
    }

    const apiKey = generateApiKey();
    const passwordHash = hashPassword(password);

    db.run(
        `
        INSERT INTO users
        (username,password,api_key,role,balance)
        VALUES (?,?,?,?,?)
        `,
        [
            username,
            passwordHash,
            apiKey,
            "user",
            0
        ],
        function(err) {

            if (err) {

                return res.status(400).json({
                    error: "Tên tài khoản đã tồn tại!"
                });

            }

            res.json({
                success: true,
                message: "Đăng ký thành công!"
            });

        }
    );
});

// ======================================================
// LOGIN
// ======================================================

app.post("/api/login", (req, res) => {

    const username =
        String(req.body.username || "").trim();

    const passwordHash =
        hashPassword(
            String(req.body.password || "")
        );

    db.get(
        `
        SELECT id,username,role,balance,api_key
        FROM users
        WHERE username = ?
        AND password = ?
        `,
        [
            username,
            passwordHash
        ],
        (err, user) => {

            if (err || !user) {

                return res.status(401).json({
                    error:
                        "Tài khoản hoặc mật khẩu không đúng!"
                });

            }

            res.json({
                success: true,
                username: user.username,
                role: user.role,
                balance: number(user.balance),
                api_key: user.api_key
            });

        }
    );
});

// ======================================================
// USER INFO
// ======================================================

app.get("/api/me", (req, res) => {

    const key = req.headers["x-api-key"];

    if (!key) {
        return res.status(401).json({
            error: "Thiếu API key"
        });
    }

    db.get(
        `
        SELECT
            id,
            username,
            role,
            balance,
            created_at
        FROM users
        WHERE api_key = ?
        `,
        [key],
        (err, user) => {

            if (err || !user) {
                return res.status(401).json({
                    error: "API key không hợp lệ"
                });
            }

            res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    balance: number(user.balance),
                    created_at: user.created_at
                }
            });

        }
    );
});

// ======================================================
// SERVICES
// ======================================================

app.get("/api/services", async (req, res) => {

    try {

        const data = await providerRequest({
            action: "services"
        });

        if (!Array.isArray(data)) {

            return res.status(502).json({
                error:
                    "API mẹ không trả về danh sách dịch vụ hợp lệ.",
                data
            });

        }

        res.json({
            success
