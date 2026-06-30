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

// Forzar a PostgreSQL a parsear los tipos NUMERIC directamente a números en JS
const { types } = require('pg');
types.setTypeParser(1700, val => parseFloat(val));

const initDB = async () => {
    try {
        // 1. Crear tabla básica de usuarios si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY, 
                username TEXT UNIQUE, 
                password TEXT
            )
        `);

        // 🔥 PARCHE DE MIGRACIÓN CRÍTICO para Render: Asegurar que las columnas de los bancos existan
        await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_ibercaja NUMERIC(12, 2) DEFAULT 0.00`);
        await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_openbank NUMERIC(12, 2) DEFAULT 0.00`);
        await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_trade_republic NUMERIC(12, 2) DEFAULT 0.00`);

        // 2. Crear tabla de movimientos si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS movimientos (
                id SERIAL PRIMARY KEY, 
                usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
                descripcion TEXT NOT NULL, 
                cantidad NUMERIC(12, 2) NOT NULL, 
                tipo TEXT NOT NULL, 
                categoria TEXT NOT NULL, 
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Insertar usuarios iniciales obligatorios de forma segura
        await pool.query("INSERT INTO usuarios (username, password) VALUES ('admin', '1234') ON CONFLICT (username) DO NOTHING");
        await pool.query("INSERT INTO usuarios (username, password) VALUES ('jose', 'jose2026') ON CONFLICT (username) DO NOTHING");
        await pool.query("INSERT INTO usuarios (username, password) VALUES ('arroyo', 'arroyo2026') ON CONFLICT (username) DO NOTHING");

        console.log('-> Servidor e Infraestructura de Base de Datos Saneada Correctamente.');
    } catch (err) { 
        console.error('Error Crítico durante la inicialización de la Base de Datos:', err.message); 
    }
};
initDB();

// API: Autenticación de usuarios
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            "SELECT id, username, saldo_ibercaja, saldo_openbank, saldo_trade_republic FROM usuarios WHERE username = $1 AND password = $2", 
            [username.toLowerCase().trim(), password]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// API: Obtener el listado de flujos financieros
app.get('/api/movimientos', async (req, res) => {
    const userId = req.query.usuario_id;
    if (!userId) return res.status(400).json({ error: "Falta el ID del usuario operativo" });
    try {
        const result = await pool.query("SELECT * FROM movimientos WHERE usuario_id = $1 ORDER BY fecha DESC", [userId]);
        res.json(result.rows);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// API: Registrar un nuevo flujo financiero (Ingreso / Gasto / Inversión)
app.post('/api/movimientos', async (req, res) => {
    const { usuario_id, descripcion, cantidad, tipo, categoria, fecha_personalizada } = req.body;
    if (!usuario_id) return res.status(400).json({ error: "Falta vincular el ID de usuario" });
    try {
        let result;
        if (fecha_personalizada && fecha_personalizada.trim() !== "") {
            result = await pool.query(
                "INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria, fecha) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
                [usuario_id, descripcion, parseFloat(cantidad), tipo, categoria, `${fecha_personalizada} 12:00:00`]
            );
        } else {
            result = await pool.query(
                "INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4, $5) RETURNING *",
                [usuario_id, descripcion, parseFloat(cantidad), tipo, categoria]
            );
        }
        res.json({ success: true, movimiento: result.rows[0] });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// API: Guardar los saldos patrimoniales de las tres entidades
app.post('/api/usuario/saldos', async (req, res) => {
    const { usuario_id, ibercaja, openbank, trade_republic } = req.body;
    try {
        await pool.query(
            "UPDATE usuarios SET saldo_ibercaja = $1, saldo_openbank = $2, saldo_trade_republic = $3 WHERE id = $4",
            [parseFloat(ibercaja) || 0, parseFloat(openbank) || 0, parseFloat(trade_republic) || 0, usuario_id]
        );
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// API: Eliminar registros operativos
app.delete('/api/movimientos/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM movimientos WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// Enrutamiento fallback para SPA frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Servidor activo y escuchando en el puerto ${PORT}`));
