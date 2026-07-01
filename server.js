require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Determine Database Strategy (PostgreSQL vs Local JSON fallback)
let useLocalJSON = false;
let pool = null;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.log('⚠️ DATABASE_URL no definida. Activando base de datos JSON local (db.json) para desarrollo...');
  useLocalJSON = true;
} else {
  console.log('🐘 DATABASE_URL detectada. Usando PostgreSQL con SSL dinámico para producción...');
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
}

// Local JSON DB File Path
const JSON_DB_FILE = path.join(__dirname, 'db.json');

// Read JSON DB file with auto-seeding
function readJSONDb() {
  if (!fs.existsSync(JSON_DB_FILE)) {
    const initialData = {
      usuarios: [
        { id: 1, username: 'admin', password: '1234' },
        { id: 2, username: 'jose', password: 'jose2026' }
      ],
      movimientos: [],
      bancos_usuario: []
    };
    fs.writeFileSync(JSON_DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
    return initialData;
  }
  try {
    const data = fs.readFileSync(JSON_DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error al parsear db.json. Recreando estructura básica...', error);
    return { usuarios: [], movimientos: [], bancos_usuario: [] };
  }
}

// Write updates to JSON DB file
function writeJSONDb(data) {
  try {
    fs.writeFileSync(JSON_DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error al guardar datos en db.json:', error);
  }
}

// Database Initialization (Sequential, Idempotent & Auto-Repair)
async function initDatabase() {
  if (useLocalJSON) {
    console.log('📁 Base de datos JSON inicializada localmente.');
    readJSONDb(); // Auto-seeding initial users
    return;
  }

  let client;
  try {
    client = await pool.connect();
    console.log('Connecting to database and running verification checks...');

    await client.query('BEGIN');

    // 1. Create table 'usuarios' first
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      );
    `);

    // 2. Verify 'movimientos' table structure compatibility
    const movimientosColCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'movimientos' AND column_name = 'usuario_id';
    `);
    
    const tableExistsResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'movimientos'
      );
    `);
    
    const movimientosTableExists = tableExistsResult.rows[0].exists;
    if (movimientosTableExists && movimientosColCheck.rows.length === 0) {
      console.log('⚠️ La tabla "movimientos" existe pero no es compatible (falta columna "usuario_id"). Recreándola...');
      await client.query('DROP TABLE IF EXISTS movimientos CASCADE;');
    }

    // 3. Create table 'movimientos' with ON DELETE CASCADE
    await client.query(`
      CREATE TABLE IF NOT EXISTS movimientos (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        descripcion TEXT NOT NULL,
        cantidad NUMERIC(12,2) NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'gasto', 'ahorro', 'inversion')),
        categoria TEXT NOT NULL,
        fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Verify 'bancos_usuario' table structure compatibility
    const bancosColCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'bancos_usuario' AND column_name = 'usuario_id';
    `);
    
    const bancosTableExistsResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'bancos_usuario'
      );
    `);
    
    const bancosTableExists = bancosTableExistsResult.rows[0].exists;
    if (bancosTableExists && bancosColCheck.rows.length === 0) {
      console.log('⚠️ La tabla "bancos_usuario" existe pero no es compatible (falta columna "usuario_id"). Recreándola...');
      await client.query('DROP TABLE IF EXISTS bancos_usuario CASCADE;');
    }

    // 5. Create table 'bancos_usuario' with UNIQUE (usuario_id, banco_nombre)
    await client.query(`
      CREATE TABLE IF NOT EXISTS bancos_usuario (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        banco_nombre TEXT NOT NULL,
        saldo NUMERIC(12,2) NOT NULL,
        CONSTRAINT unique_usuario_banco UNIQUE (usuario_id, banco_nombre)
      );
    `);

    // 6. Seed admin user
    const adminCheck = await client.query('SELECT * FROM usuarios WHERE username = $1', ['admin']);
    if (adminCheck.rows.length === 0) {
      await client.query('INSERT INTO usuarios (username, password) VALUES ($1, $2)', ['admin', '1234']);
      console.log('Seeded default admin user: admin / 1234');
    }

    // 7. Seed test user
    const joseCheck = await client.query('SELECT * FROM usuarios WHERE username = $1', ['jose']);
    if (joseCheck.rows.length === 0) {
      await client.query('INSERT INTO usuarios (username, password) VALUES ($1, $2)', ['jose', 'jose2026']);
      console.log('Seeded default test user: jose / jose2026');
    }

    await client.query('COMMIT');
    console.log('Database initialized and auto-repaired successfully.');
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Fatal Database Initialization Error. Server will run but DB functionality might fail: ', error.message);
  } finally {
    if (client) {
      client.release();
    }
  }
}

// ------------------- API ROUTES -------------------

// POST /api/login - Basic authentication
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'El nombre de usuario y la contraseña son obligatorios.' });
  }

  try {
    if (useLocalJSON) {
      const db = readJSONDb();
      const user = db.usuarios.find(u => u.username === username);
      if (!user) {
        return res.status(401).json({ error: 'El usuario no existe.' });
      }
      if (user.password !== password) {
        return res.status(401).json({ error: 'Contraseña incorrecta.' });
      }
      return res.json({
        id: user.id,
        username: user.username,
        isAdmin: user.username === 'admin'
      });
    } else {
      const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'El usuario no existe.' });
      }

      const user = result.rows[0];
      if (user.password !== password) {
        return res.status(401).json({ error: 'Contraseña incorrecta.' });
      }

      return res.json({
        id: user.id,
        username: user.username,
        isAdmin: user.username === 'admin'
      });
    }
  } catch (error) {
    console.error('Error en POST /api/login:', error);
    return res.status(500).json({ error: 'Error interno del servidor al iniciar sesión.', details: error.message });
  }
});

// GET /api/movimientos - Get movements for active user
app.get('/api/movimientos', async (req, res) => {
  const { usuario_id } = req.query;
  if (!usuario_id) {
    return res.status(400).json({ error: 'Se requiere el parámetro usuario_id.' });
  }

  try {
    if (useLocalJSON) {
      const db = readJSONDb();
      const list = db.movimientos
        .filter(m => m.usuario_id === parseInt(usuario_id))
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha) || b.id - a.id);
      return res.json(list);
    } else {
      const result = await pool.query(
        'SELECT id, descripcion, cantidad, tipo, categoria, fecha FROM movimientos WHERE usuario_id = $1 ORDER BY fecha DESC, id DESC',
        [usuario_id]
      );
      return res.json(result.rows);
    }
  } catch (error) {
    console.error('Error en GET /api/movimientos:', error);
    return res.status(500).json({ error: 'Error al consultar los movimientos.', details: error.message });
  }
});

// POST /api/movimientos - Insert a new movement
app.post('/api/movimientos', async (req, res) => {
  const { usuario_id, descripcion, cantidad, tipo, categoria, fecha } = req.body;
  if (!usuario_id || !descripcion || cantidad === undefined || !tipo || !categoria) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para registrar el movimiento.' });
  }

  try {
    if (useLocalJSON) {
      const db = readJSONDb();
      const newMove = {
        id: db.movimientos.length > 0 ? Math.max(...db.movimientos.map(m => m.id)) + 1 : 1,
        usuario_id: parseInt(usuario_id),
        descripcion,
        cantidad: parseFloat(cantidad),
        tipo,
        categoria,
        fecha: fecha || new Date().toISOString()
      };
      db.movimientos.push(newMove);
      writeJSONDb(db);
      return res.status(201).json(newMove);
    } else {
      let result;
      if (fecha) {
        result = await pool.query(
          'INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria, fecha) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
          [usuario_id, descripcion, cantidad, tipo, categoria, fecha]
        );
      } else {
        result = await pool.query(
          'INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [usuario_id, descripcion, cantidad, tipo, categoria]
        );
      }
      return res.status(201).json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error en POST /api/movimientos:', error);
    return res.status(500).json({ error: 'Error al registrar el movimiento.', details: error.message });
  }
});

// DELETE /api/movimientos/:id - Delete a movement
app.delete('/api/movimientos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    if (useLocalJSON) {
      const db = readJSONDb();
      const initialLength = db.movimientos.length;
      db.movimientos = db.movimientos.filter(m => m.id !== parseInt(id));
      
      if (db.movimientos.length === initialLength) {
        return res.status(404).json({ error: 'Movimiento no encontrado.' });
      }
      
      writeJSONDb(db);
      return res.json({ success: true, message: 'Movimiento eliminado correctamente.' });
    } else {
      const result = await pool.query('DELETE FROM movimientos WHERE id = $1 RETURNING *', [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Movimiento no encontrado.' });
      }
      return res.json({ success: true, message: 'Movimiento eliminado correctamente.' });
    }
  } catch (error) {
    console.error('Error en DELETE /api/movimientos:', error);
    return res.status(500).json({ error: 'Error al eliminar el movimiento.', details: error.message });
  }
});

// GET /api/bancos - Get banks list and balances
app.get('/api/bancos', async (req, res) => {
  const { usuario_id } = req.query;
  if (!usuario_id) {
    return res.status(400).json({ error: 'Se requiere el parámetro usuario_id.' });
  }

  try {
    if (useLocalJSON) {
      const db = readJSONDb();
      const list = db.bancos_usuario
        .filter(b => b.usuario_id === parseInt(usuario_id))
        .sort((a, b) => a.banco_nombre.localeCompare(b.banco_nombre));
      return res.json(list);
    } else {
      const result = await pool.query(
        'SELECT id, banco_nombre, saldo FROM bancos_usuario WHERE usuario_id = $1 ORDER BY banco_nombre ASC',
        [usuario_id]
      );
      return res.json(result.rows);
    }
  } catch (error) {
    console.error('Error en GET /api/bancos:', error);
    return res.status(500).json({ error: 'Error al consultar los saldos bancarios.', details: error.message });
  }
});

// POST /api/bancos - Save or update bank balance (UPSERT)
app.post('/api/bancos', async (req, res) => {
  const { usuario_id, banco_nombre, saldo } = req.body;
  if (!usuario_id || !banco_nombre || saldo === undefined) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para actualizar el saldo bancario.' });
  }

  try {
    const uId = parseInt(usuario_id);
    const sVal = parseFloat(saldo);

    if (useLocalJSON) {
      const db = readJSONDb();
      let bank = db.bancos_usuario.find(b => b.usuario_id === uId && b.banco_nombre === banco_nombre);
      
      if (bank) {
        bank.saldo = sVal;
      } else {
        bank = {
          id: db.bancos_usuario.length > 0 ? Math.max(...db.bancos_usuario.map(b => b.id)) + 1 : 1,
          usuario_id: uId,
          banco_nombre,
          saldo: sVal
        };
        db.bancos_usuario.push(bank);
      }
      
      writeJSONDb(db);
      return res.json(bank);
    } else {
      const result = await pool.query(
        `INSERT INTO bancos_usuario (usuario_id, banco_nombre, saldo)
         VALUES ($1, $2, $3)
         ON CONFLICT (usuario_id, banco_nombre)
         DO UPDATE SET saldo = EXCLUDED.saldo
         RETURNING *`,
        [uId, banco_nombre, sVal]
      );
      return res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error en POST /api/bancos:', error);
    return res.status(500).json({ error: 'Error al guardar el saldo bancario.', details: error.message });
  }
});

// ------------------- ADMIN ROUTES -------------------

// GET /api/admin/usuarios - Get list of users (Admin only)
app.get('/api/admin/usuarios', async (req, res) => {
  const { requester_id } = req.query;
  if (!requester_id) {
    return res.status(401).json({ error: 'Acceso no autorizado. Identificación del solicitante ausente.' });
  }

  try {
    const reqUserId = parseInt(requester_id);

    if (useLocalJSON) {
      const db = readJSONDb();
      const reqUser = db.usuarios.find(u => u.id === reqUserId);
      if (!reqUser || reqUser.username !== 'admin') {
        return res.status(403).json({ error: 'Permisos insuficientes. Solo el administrador puede ver esta sección.' });
      }
      
      const list = db.usuarios.map(u => ({ id: u.id, username: u.username })).sort((a, b) => a.username.localeCompare(b.username));
      return res.json(list);
    } else {
      const reqUser = await pool.query('SELECT username FROM usuarios WHERE id = $1', [reqUserId]);
      if (reqUser.rows.length === 0 || reqUser.rows[0].username !== 'admin') {
        return res.status(403).json({ error: 'Permisos insuficientes. Solo el administrador puede ver esta sección.' });
      }

      const result = await pool.query('SELECT id, username FROM usuarios ORDER BY username ASC');
      return res.json(result.rows);
    }
  } catch (error) {
    console.error('Error en GET /api/admin/usuarios:', error);
    return res.status(500).json({ error: 'Error al consultar la lista de usuarios.', details: error.message });
  }
});

// POST /api/admin/usuarios - Register new user (Admin only)
app.post('/api/admin/usuarios', async (req, res) => {
  const { requester_id, username, password } = req.body;
  if (!requester_id || !username || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  try {
    const reqUserId = parseInt(requester_id);

    if (useLocalJSON) {
      const db = readJSONDb();
      const reqUser = db.usuarios.find(u => u.id === reqUserId);
      if (!reqUser || reqUser.username !== 'admin') {
        return res.status(403).json({ error: 'Permisos insuficientes. Solo el administrador puede registrar usuarios.' });
      }

      if (db.usuarios.some(u => u.username === username)) {
        return res.status(400).json({ error: 'El nombre de usuario ya está en uso.' });
      }

      const newUser = {
        id: db.usuarios.length > 0 ? Math.max(...db.usuarios.map(u => u.id)) + 1 : 1,
        username,
        password
      };
      db.usuarios.push(newUser);
      writeJSONDb(db);
      
      return res.status(201).json({ id: newUser.id, username: newUser.username });
    } else {
      const reqUser = await pool.query('SELECT username FROM usuarios WHERE id = $1', [reqUserId]);
      if (reqUser.rows.length === 0 || reqUser.rows[0].username !== 'admin') {
        return res.status(403).json({ error: 'Permisos insuficientes. Solo el administrador puede registrar usuarios.' });
      }

      const userCheck = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);
      if (userCheck.rows.length > 0) {
        return res.status(400).json({ error: 'El nombre de usuario ya está en uso.' });
      }

      const result = await pool.query(
        'INSERT INTO usuarios (username, password) VALUES ($1, $2) RETURNING id, username',
        [username, password]
      );
      return res.status(201).json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error en POST /api/admin/usuarios:', error);
    return res.status(500).json({ error: 'Error al registrar el nuevo usuario.', details: error.message });
  }
});

// DELETE /api/admin/usuarios/:id - Cascade delete user (Admin only)
app.delete('/api/admin/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { requester_id } = req.query;

  if (!requester_id) {
    return res.status(401).json({ error: 'Acceso no autorizado. Identificación del solicitante ausente.' });
  }

  try {
    const reqUserId = parseInt(requester_id);
    const targetUserId = parseInt(id);

    if (reqUserId === targetUserId) {
      return res.status(400).json({ error: 'No se puede eliminar el usuario administrador activo.' });
    }

    if (useLocalJSON) {
      const db = readJSONDb();
      const reqUser = db.usuarios.find(u => u.id === reqUserId);
      if (!reqUser || reqUser.username !== 'admin') {
        return res.status(403).json({ error: 'Permisos insuficientes. Solo el administrador puede eliminar usuarios.' });
      }

      const userIdx = db.usuarios.findIndex(u => u.id === targetUserId);
      if (userIdx === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado.' });
      }

      const deletedUsername = db.usuarios[userIdx].username;
      
      // Cascade delete user and data
      db.usuarios.splice(userIdx, 1);
      db.movimientos = db.movimientos.filter(m => m.usuario_id !== targetUserId);
      db.bancos_usuario = db.bancos_usuario.filter(b => b.usuario_id !== targetUserId);
      
      writeJSONDb(db);
      return res.json({ success: true, message: `Usuario '${deletedUsername}' eliminado correctamente con todos sus datos asociados.` });
    } else {
      const reqUser = await pool.query('SELECT username FROM usuarios WHERE id = $1', [reqUserId]);
      if (reqUser.rows.length === 0 || reqUser.rows[0].username !== 'admin') {
        return res.status(403).json({ error: 'Permisos insuficientes. Solo el administrador puede eliminar usuarios.' });
      }

      const result = await pool.query('DELETE FROM usuarios WHERE id = $1 RETURNING id, username', [targetUserId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado.' });
      }

      return res.json({ success: true, message: `Usuario '${result.rows[0].username}' eliminado correctamente con todos sus datos asociados.` });
    }
  } catch (error) {
    console.error('Error en DELETE /api/admin/usuarios:', error);
    return res.status(500).json({ error: 'Error al eliminar el usuario.', details: error.message });
  }
});

// Serve frontend SPA file
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize database, then start the server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
});
