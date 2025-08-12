const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";

let entries = [];

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
    secret: "termeles-secret",
    resave: false,
    saveUninitialized: true
}));

function auth(req, res, next) {
    if (req.session.loggedIn) {
        return next();
    }
    res.redirect("/");
}

app.post("/login", (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        req.session.loggedIn = true;
        res.redirect("/admin");
    } else {
        res.send("Hibás jelszó!");
    }
});

app.post("/add", (req, res) => {
    const { date, machine, product, quantity, scrap, note } = req.body;
    entries.push({ date, machine, product, quantity, scrap, note });
    res.redirect("/");
});

app.get("/admin", auth, (req, res) => {
    res.sendFile(path.join(__dirname, "views", "admin.html"));
});

app.get("/data", auth, (req, res) => {
    res.json(entries);
});

app.listen(PORT, () => console.log(`Szerver fut a http://localhost:${PORT} címen`));
