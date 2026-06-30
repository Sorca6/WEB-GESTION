const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
// Puerto adaptado para producción (Render) y entorno local (3000)
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configuración de conexión con PostgreSQL remota
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false // Obligatorio para SSL en Render
});

// Inicialización automática de las tablas en la nube
const initDB = async () => {
    try {
        // 1. Tabla de Usuarios
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT
            )
        `);

        // Insertar usuario administrador predeterminado si la tabla está vacía
        const userCheck = await pool.query("SELECT COUNT(*) FROM usuarios");
        if (parseInt(userCheck.rows[0].count) === 0) {
            await pool.query("INSERT INTO usuarios (username, password) VALUES ('admin', '1234')");
            console.log('-> Usuario base (admin/1234) creado correctamente.');
        }

        // 2. Tabla de Movimientos Financieros (Ingresos, Gastos, Inversiones)
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
        console.log('-> Estructura PostgreSQL verificada y lista para operar.');
    } catch (err) {
        console.error('Error crítico inicializando la base de datos:', err.message);
    }
};

initDB();

// --- ENDPOINTS DE LA API ---

// Login de Usuario
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            "SELECT * FROM usuarios WHERE username = $1 AND password = $2",
            [username, password]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, username: result.rows[0].username });
        } else {
            res.status(401).json({ success: false, message: "Usuario o contraseña inválidos" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Obtener el historial completo
app.get('/api/movimientos', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM movimientos ORDER BY fecha DESC");
        // Convertimos los valores decimales de string a float para el uso de Javascript en el cliente
        const datosMapeados = result.rows.map(row => ({
            ...row,
            cantidad: parseFloat(row.cantidad)
        }));
        res.json(datosMapeados);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Registrar un nuevo movimiento financiero
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
    console.log(`Servidor activo en http://localhost:${PORT}`);
});
