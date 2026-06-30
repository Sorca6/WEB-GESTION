const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT
            )
        `);

        const defaultUser = process.env.ADMIN_USER || 'admin';
        const defaultPass = process.env.ADMIN_PASS || '1234';

        const userCheck = await pool.query("SELECT COUNT(*) FROM usuarios WHERE username = $1", [defaultUser]);
        if (parseInt(userCheck.rows[0].count) === 0) {
            await pool.query("INSERT INTO usuarios (username, password) VALUES ($1, $2)", [defaultUser, defaultPass]);
            console.log('-> Usuario administrador personalizado configurado con éxito.');
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS movimientos (
                id SERIAL PRIMARY KEY,
                descripcion TEXT NOT NULL,
                cantidad NUMERIC(12, 2) NOT NULL,
                tipo TEXT NOT NULL,       
                categoria TEXT NOT NULL,  
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('-> Estructura PostgreSQL verificada de forma segura.');
    } catch (err) {
        console.error('Error crítico inicializando la base de datos:', err.message);
    }
};

initDB();

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE username = $1 AND password = $2", [username, password]);
        if (result.rows.length > 0) {
            res.json({ success: true, username: result.rows[0].username });
        } else {
            res.status(401).json({ success: false, message: "Credenciales inválidas" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/movimientos', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM movimientos ORDER BY fecha DESC");
        const datosMapeados = result.rows.map(row => ({ ...row, cantidad: parseFloat(row.cantidad) }));
        res.json(datosMapeados);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/movimientos', async (req, res) => {
    const { descripcion, cantidad, tipo, categoria } = req.body;
    if (!descripcion || !cantidad || !tipo || !categoria) {
        return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    try {
        const result = await pool.query(
            "INSERT INTO movimientos (descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4) RETURNING *",
            [descripcion, cantidad, tipo, categoria]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});
