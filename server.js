const express = require("express");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

const API_URL =
  process.env.SIEULIKE_API_URL ||
  "https://sieulike.com/api/v2";

const API_KEY =
  process.env.SIEULIKE_API_KEY || "";

const ADMIN =
  process.env.ADMIN_USERNAME ||
  "nghuy291211";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  "CHANGE_ME";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database(
  path.join(__dirname, "database.db")
);

function makeKey() {
  return crypto.randomBytes(24).toString("hex");
}

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/* ================= DATABASE ================= */

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
      rate REAL DEFAULT 0,
      total REAL DEFAULT 0,
      provider_order_id TEXT,
      status TEXT DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.get(
    "SELECT id FROM users WHERE username=?",
    [ADMIN],
    (err, row) => {

      if (!err && !row) {

        db.run(
          `INSERT INTO users
           (username,password,api_key,role,balance)
           VALUES (?,?,?,?,0)`,
          [
            ADMIN,
            ADMIN_PASSWORD,
            makeKey(),
            "admin"
          ]
        );

        console.log(
          "Đã tạo tài khoản admin:",
          ADMIN
        );
      }
    }
  );

});

/* ================= API MẸ ================= */

async function mother(data) {

  if (!API_KEY) {
    throw new Error(
      "SIEULIKE_API_KEY chưa được cấu hình"
    );
  }

  const body = new URLSearchParams({
    key: API_KEY,
    ...data
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

/* ================= AUTH ================= */

function auth(req, res, next) {

  const apiKey =
    req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({
      error: "Thiếu API key"
    });
  }

  db.get(
    "SELECT * FROM users WHERE api_key=?",
    [apiKey],
    (err, user) => {

      if (err || !user) {
        return res.status(401).json({
          error: "API key không hợp lệ"
        });
      }

      req.user = user;
      next();
    }
  );
}

function admin(req, res, next) {

  if (req.user.role !== "admin") {
    return res.status(403).json({
      error: "Không có quyền quản trị"
    });
  }

  next();
}

/* ================= HEALTH ================= */

app.get("/api/health", (req, res) => {

  res.json({
    ok: true,
    api_configured: !!API_KEY
  });

});

/* ================= REGISTER ================= */

app.post("/api/register", (req, res) => {

  const username =
    String(req.body.username || "").trim();

  const password =
    String(req.body.password || "");

  if (
    username.length < 3 ||
    password.length < 6
  ) {
    return res.status(400).json({
      error:
        "Tài khoản >= 3 ký tự, mật khẩu >= 6 ký tự"
    });
  }

  db.run(
    `INSERT INTO users
     (username,password,api_key)
     VALUES (?,?,?)`,
    [
      username,
      password,
      makeKey()
    ],
    err => {

      if (err) {
        return res.status(400).json({
          error:
            "Tên tài khoản đã tồn tại"
        });
      }

      res.json({
        success: true,
        message:
          "Đăng ký thành công"
      });

    }
  );

});

/* ================= LOGIN ================= */

app.post("/api/login", (req, res) => {

  const username =
    String(req.body.username || "").trim();

  const password =
    String(req.body.password || "");

  db.get(
    `SELECT
       id,
       username,
       role,
       balance,
       api_key
     FROM users
     WHERE username=?
     AND password=?`,
    [
      username,
      password
    ],
    (err, user) => {

      if (err || !user) {
        return res.status(401).json({
          error:
            "Tài khoản hoặc mật khẩu không đúng"
        });
      }

      res.json({
        success: true,
        ...user,
        balance:
          num(user.balance)
      });

    }
  );

});

/* ================= USER INFO ================= */

app.get("/api/me", auth, (req, res) => {

  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      balance: num(req.user.balance)
    }
  });

});

/* ================= SERVICES ================= */

app.get("/api/services", async (req, res) => {

  try {

    const data =
      await mother({
        action: "services"
      });

    res.json({
      success: true,
      services:
        Array.isArray(data)
          ? data
          : []
    });

  } catch (err) {

    console.error(
      "SERVICES:",
      err.response?.data ||
      err.message
    );

    res.status(502).json({
      error:
        "Không lấy được dịch vụ từ API mẹ"
    });

  }

});

/* ================= CREATE ORDER ================= */

app.post("/api/order", auth, async (req, res) => {

  const serviceId =
    String(req.body.service || "");

  const link =
    String(req.body.link || "").trim();

  const quantity =
    parseInt(req.body.quantity, 10);

  if (
    !serviceId ||
    !link ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return res.status(400).json({
      error:
        "Dữ liệu đặt đơn không hợp lệ"
    });
  }

  try {

    /* Lấy dịch vụ thật */

    const services =
      await mother({
        action: "services"
      });

    const service =
      services.find(
        x =>
          String(x.service) ===
          serviceId
      );

    if (!service) {
      return res.status(400).json({
        error:
          "Dịch vụ không tồn tại"
      });
    }

    const rate =
      num(service.rate);

    const min =
      num(service.min);

    const max =
      num(service.max);

    if (min && quantity < min) {
      return res.status(400).json({
        error:
          `Số lượng tối thiểu: ${min}`
      });
    }

    if (max && quantity > max) {
      return res.status(400).json({
        error:
          `Số lượng tối đa: ${max}`
      });
    }

    /* Tính tiền */

    const total =
      quantity / 1000 * rate;

    if (total <= 0) {
      return res.status(400).json({
        error:
          "Giá dịch vụ không hợp lệ"
      });
    }

    const before =
      num(req.user.balance);

    const after =
      before - total;

    if (after < 0) {
      return res.status(400).json({
        error:
          "Số dư không đủ"
      });
    }

    /*
      Trừ tiền trước.
      Nếu API mẹ lỗi sẽ hoàn tiền.
    */

    db.run(
      `UPDATE users
       SET balance=?
       WHERE id=?
       AND balance>=?`,
      [
        after,
        req.user.id,
        total
      ],
      async function(err) {

        if (
          err ||
          this.changes !== 1
        ) {
          return res.status(400).json({
            error:
              "Số dư không đủ hoặc không thể cập nhật"
          });
        }

        try {

          /* Gửi đơn lên API mẹ */

          const result =
            await mother({
              action: "add",
              service: serviceId,
              link: link,
              quantity: quantity
            });

          if (
            !result ||
            !result.order
          ) {
            throw new Error(
              result?.error ||
              "API mẹ không tạo được đơn"
            );
          }

          /* Lưu đơn */

          db.run(
            `INSERT INTO orders
             (
               user_id,
               service_id,
               service_name,
               link,
               quantity,
               rate,
               total,
               provider_order_id
             )
             VALUES (?,?,?,?,?,?,?,?)`,
            [
              req.user.id,
              serviceId,
              service.name || "",
              link,
              quantity,
              rate,
              total,
              String(result.order)
            ]
          );

          res.json({
            success: true,
            order:
              result.order,
            total:
              total,
            balance:
              after
          });

        } catch (error) {

          /* API mẹ lỗi -> hoàn tiền */

          db.run(
            `UPDATE users
             SET balance=balance+?
             WHERE id=?`,
            [
              total,
              req.user.id
            ]
          );

          console.error(
            "ORDER:",
            error.response?.data ||
            error.message
          );

          res.status(502).json({
            error:
              "API mẹ không tạo được đơn, tiền đã hoàn lại"
          });

        }

      }
    );

  } catch (error) {

    console.error(
      "ORDER SERVICES:",
      error.response?.data ||
      error.message
    );

    res.status(502).json({
      error:
        "Không kết nối được API mẹ"
    });

  }

});

/* ================= USER ORDERS ================= */

app.get(
  "/api/orders",
  auth,
  (req, res) => {

    db.all(
      `SELECT *
       FROM orders
       WHERE user_id=?
       ORDER BY id DESC
       LIMIT 100`,
      [req.user.id],
      (err, orders) => {

        if (err) {
          return res.status(500).json({
            error:
              "Không lấy được đơn hàng"
          });
        }

        res.json({
          success: true,
          orders
        });

      }
    );

  }
);

/* ================= ADMIN API BALANCE ================= */

app.get(
  "/api/admin/provider-balance",
  auth,
  admin,
  async (req, res) => {

    try {

      const data =
        await mother({
          action: "balance"
        });

      res.json({
        success: true,
        balance:
          num(data.balance),
        currency:
          data.currency || "VND"
      });

    } catch (error) {

      console.error(
        "BALANCE:",
        error.response?.data ||
        error.message
      );

      res.status(502).json({
        error:
          "Không lấy được số dư API mẹ"
      });

    }

  }
);

/* ================= ADMIN USERS ================= */

app.get(
  "/api/admin/users",
  auth,
  admin,
  (req, res) => {

    db.all(
      `SELECT
         id,
         username,
         role,
         balance,
         created_at
       FROM users
       ORDER BY id DESC`,
      [],
      (err, users) => {

        if (err) {
          return res.status(500).json({
            error:
              "Không lấy được tài khoản"
          });
        }

        res.json({
          success: true,
          users
        });

      }
    );

  }
);

/* ================= ADMIN BALANCE ================= */

app.post(
  "/api/admin/balance",
  auth,
  admin,
  (req, res) => {

    const username =
      String(
        req.body.username || ""
      ).trim();

    const amount =
      num(req.body.amount);

    const type =
      req.body.type === "subtract"
        ? "subtract"
        : "add";

    if (
      !username ||
      amount <= 0
    ) {
      return res.status(400).json({
        error:
          "Dữ liệu không hợp lệ"
      });
    }

    const operator =
      type === "add"
        ? "+"
        : "-";

    const condition =
      type === "subtract"
        ? "AND balance>=?"
        : "";

    const params =
      type === "subtract"
        ? [amount, username, amount]
        : [amount, username];

    db.run(
      `UPDATE users
       SET balance=balance${operator}?
       WHERE username=?
       ${condition}`,
      params,
      function(err) {

        if (
          err ||
          this.changes !== 1
        ) {
          return res.status(400).json({
            error:
              "Không tìm thấy tài khoản hoặc số dư không đủ"
          });
        }

        db.get(
          `SELECT balance
           FROM users
           WHERE username=?`,
          [username],
          (e, user) => {

            res.json({
              success: true,
              balance:
                num(user?.balance)
            });

          }
        );

      }
    );

  }
);

/* ================= API CŨ ================= */

app.post("/api/v2", async (req, res) => {

  try {

    if (
      req.body.action ===
      "services"
    ) {
      return res.json(
        await mother({
          action: "services"
        })
      );
    }

    if (
      req.body.action ===
      "balance"
    ) {
      return res.json(
        await mother({
          action: "balance"
        })
      );
    }

    return res.status(400).json({
      error:
        "Action không hợp lệ"
    });

  } catch (error) {

    res.status(502).json({
      error:
        error.message
    });

  }

});

/* ================= FRONTEND ================= */

app.get("*", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );

});

/* ================= START ================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Server running on port ${PORT}`
    );
    console.log(
      `API: ${API_URL}`
    );
    console.log(
      `API key: ${
        API_KEY
          ? "OK"
          : "CHƯA CẤU HÌNH"
      }`
    );
  }
);
