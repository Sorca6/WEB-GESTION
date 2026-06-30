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
        console.log('-> Infraestructura PostgreSQL Conectada y Segura.');
    } catch (err) {
        console.error('Error inicializando base de datos:', err.message);
    }
};

initDB();

// Verificador y Automatizador de Gastos/Inversiones Fijas al Inicio de Mes
const procesarAutomatizacionesMes = async () => {
    try {
        const hoy = new Date();
        const mesActual = hoy.getMonth() + 1;
        const anioActual = hoy.getFullYear();

        // Lista de automatizaciones fijas que deseas inyectar todos los meses automáticamente
        const automatizacionesFijas = [
            { desc: "🤖 [Auto] Compra MSCI World", cant: 100.00, tipo: "inversion", cat: "inicio_mes_auto" },
            { desc: "🤖 [Auto] Compra Nasdaq-100", cant: 30.00, tipo: "inversion", cat: "inicio_mes_auto" },
            { desc: "🤖 [Auto] Compra Mercados Emergentes", cant: 20.00, tipo: "inversion", cat: "inicio_mes_auto" },
            { desc: "🤖 [Auto] Compra Ethereum (ETH)", cant: 15.00, tipo: "inversion", cat: "inicio_mes_auto" }
        ];

        for (const auto of automatizacionesFijas) {
            // Verificar si esta automatización ya fue ejecutada en el mes en curso
            const check = await pool.query(
                `SELECT * FROM movimientos 
                 WHERE descripcion = $1 
                 AND EXTRACT(MONTH FROM fecha) = $2 
                 AND EXTRACT(YEAR FROM fecha) = $3`,
                [auto.desc, mesActual, anioActual]
            );

            // Si no existe registro este mes, el servidor lo introduce de forma totalmente autónoma
            if (check.rows.length === 0) {
                await pool.query(
                    "INSERT INTO movimientos (descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4)",
                    [auto.desc, auto.cant, auto.tipo, auto.cat]
                );
                console.log(`-> Automatización ejecutada con éxito: ${auto.desc}`);
            }
        }
    } catch (err) {
        console.error("Error en proceso secundario de automatizaciones:", err.message);
    }
};

// API: Autenticación
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE username = $1 AND password = $2", [username, password]);
        if (result.rows.length > 0) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API: Obtener movimientos con ejecución automática latente
app.get('/api/movimientos', async (req, res) => {
    try {
        // Cada vez que el cliente refresca el dashboard, el servidor comprueba el calendario
        await procesarAutomatizacionesMes();

        const result = await pool.query("SELECT * FROM movimientos ORDER BY fecha DESC");
        const datosMapeados = result.rows.map(row => ({
            ...row,
            cantidad: parseFloat(row.cantidad)
        }));
        res.json(datosMapeados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API: Registrar operaciones con soporte para FECHA PERSONALIZADA
app.post('/api/movimientos', async (req, res) => {
    const { descripcion, cantidad, tipo, categoria, fecha_personalizada } = req.body;
    try {
        let result;
        if (fecha_personalizada) {
            // Si el usuario eligió una fecha en el calendario, se fuerza su almacenamiento con marca horaria limpia
            result = await pool.query(
                "INSERT INTO movimientos (descripcion, cantidad, tipo, categoria, fecha) VALUES ($1, $2, $3, $4, $5) RETURNING *",
                [descripcion, cantidad, tipo, categoria, `${fecha_personalizada} 12:00:00`]
            );
        } else {
            // Si se deja vacío, entra la marca temporal automática del sistema (hoy)
            result = await pool.query(
                "INSERT INTO movimientos (descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4) RETURNING *",
                [descripcion, cantidad, tipo, categoria]
            );
        }
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API: Eliminar
app.delete('/api/movimientos/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM movimientos WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
    console.log(`Servidor Quantum Financiero activo en puerto ${PORT}`);
});
