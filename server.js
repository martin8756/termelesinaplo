const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");
const helmet = require("helmet");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";
const SESSION_SECRET = process.env.SESSION_SECRET || "change_this_secret";

// Middleware
app.use(helmet());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 3600 * 1000 } // 1 nap
}));

// Statikus fájlok
app.use(express.static(path.join(__dirname, "public")));

// DB init
const dbPath = path.join(__dirname, "data.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error("DB megnyitási hiba:", err); process.exit(1); }
  console.log("SQLite csatlakoztatva:", dbPath);
});
db.run(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    machine TEXT NOT NULL,
    product TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    rejects INTEGER DEFAULT 0,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Auth segédfüggvény
function ensureAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ ok: false, message: "Nincs jogosultság" });
}

// Bejelentkezés / kijelentkezés
app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ ok: false, message: "Hiányzó jelszó" });
  if (password === ADMIN_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, message: "Hibás jelszó" });
});
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Rekord felvitel (közös belépéssel védve)
app.post("/api/records", ensureAuth, (req, res) => {
  const { date, machine, product, quantity, rejects, note } = req.body || {};
  if (!date || !machine || !product || quantity === undefined)
    return res.status(400).json({ ok: false, message: "Hiányzó mezők" });

  const q = `INSERT INTO records (date, machine, product, quantity, rejects, note)
             VALUES (?, ?, ?, ?, ?, ?);`;
  db.run(q, [date, machine, product, Number(quantity), Number(rejects || 0), note || null], function(err){
    if (err) return res.status(500).json({ ok: false, message: "DB hiba" });
    return res.json({ ok: true, id: this.lastID });
  });
});

// Lista (fő nézet – utolsó 1000)
app.get("/api/records", ensureAuth, (req, res) => {
  db.all(`SELECT * FROM records ORDER BY created_at DESC LIMIT 1000;`, [], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, message: "DB hiba" });
    res.json({ ok: true, rows });
  });
});

// --- ADMIN API: szűrt lekérdezés + metrikák ---
app.get("/api/admin/records", ensureAuth, (req, res) => {
  const { from, to, machine, product } = req.query;
  const where = [];
  const params = [];

  if (from) { where.push("date >= ?"); params.push(from); }
  if (to) { where.push("date <= ?"); params.push(to); }
  if (machine) { where.push("machine LIKE ?"); params.push(`%${machine}%`); }
  if (product) { where.push("product LIKE ?"); params.push(`%${product}%`); }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `SELECT * FROM records ${whereSql} ORDER BY date DESC, created_at DESC;`;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ ok:false, message:"DB hiba" });

    // Összesítések
    const totals = rows.reduce((acc, r) => {
      acc.qty += Number(r.quantity)||0;
      acc.rej += Number(r.rejects)||0;
      return acc;
    }, { qty:0, rej:0 });
    const rejRate = totals.qty ? (totals.rej / totals.qty) * 100 : 0;

    res.json({ ok:true, rows, totals: { quantity: totals.qty, rejects: totals.rej, rejectRate: Number(rejRate.toFixed(2)) }});
  });
});

// ADMIN: törlés
app.delete("/api/admin/records/:id", ensureAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok:false, message:"Hiányzó ID" });
  db.run(`DELETE FROM records WHERE id = ?`, [id], function(err){
    if (err) return res.status(500).json({ ok:false, message:"DB hiba" });
    if (this.changes === 0) return res.status(404).json({ ok:false, message:"Nem található" });
    res.json({ ok:true });
  });
});

// ADMIN oldal (védett)
app.get("/admin", ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});

// Alap: app (index)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Szerver fut: http://localhost:${PORT}`));
