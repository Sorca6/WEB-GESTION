const bookingForm = document.querySelector('#booking-form');
const dateField = bookingForm.elements.date;
const timeField = bookingForm.elements.time;
const serviceField = bookingForm.elements.service;
const bookingFeedback = document.querySelector('#form-feedback');
const now = new Date();
const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
dateField.min = today;

function durationOf(service) {
  if (/claritos|global/i.test(service)) return 150;
  if (/corte y barba/i.test(service)) return 45;
  if (/^corte/i.test(service)) return 30;
  if (/permanentes/i.test(service)) return 90;
  return 60;
}

async function refreshTimes() {
  const date = dateField.value;
  const day = date ? new Date(`${date}T12:00:00`).getDay() : -1;
  timeField.innerHTML = '<option value="">Elige una hora</option>';
  if (!date || day === 0 || day === 1) return;
  const duration = durationOf(serviceField.value);
  const close = day === 6 ? 900 : 1140;
  const times = [];
  for (let minute = 600; minute < close; minute += 30) {
    const end = minute + duration;
    const inHours = day === 6 ? end <= 900 : (minute < 840 ? end <= 840 : minute >= 960 && end <= 1140);
    if (inHours) times.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
  }
  try {
    const response = await fetch(`/api/availability?date=${encodeURIComponent(date)}`);
    if (!response.ok) throw new Error('availability');
    const busy = await response.json();
    for (const time of times) {
      const start = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
      const taken = busy.some(item => {
        const occupied = Number(item.time.slice(0, 2)) * 60 + Number(item.time.slice(3, 5));
        return start < occupied + item.durationMinutes && occupied < start + duration;
      });
      const option = document.createElement('option');
      option.value = time;
      option.textContent = taken ? `${time} · OCUPADA` : time;
      option.disabled = taken;
      timeField.append(option);
    }
    if (times.length && !Array.from(timeField.options).some(option => option.value && !option.disabled)) timeField.options[0].textContent = 'No quedan horas disponibles';
  } catch { timeField.options[0].textContent = 'No se pudo cargar el horario'; }
}
dateField.addEventListener('change', refreshTimes);
serviceField.addEventListener('change', refreshTimes);

const menuToggle = document.querySelector('#menu-toggle');
menuToggle.addEventListener('click', () => {
  const nav = document.querySelector('.nav');
  const isOpen = nav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.textContent = isOpen ? '×' : '☰';
});
document.querySelectorAll('.nav a').forEach(link => link.addEventListener('click', () => {
  document.querySelector('.nav').classList.remove('open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.textContent = '☰';
}));

bookingForm.addEventListener('submit', async event => {
  event.preventDefault();
  bookingFeedback.className = 'feedback';
  bookingFeedback.textContent = 'ENVIANDO TU SOLICITUD…';
  try {
    const response = await fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(bookingForm).entries())) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo solicitar la cita.');
    bookingFeedback.textContent = 'LISTO. RECIBIMOS TU SOLICITUD Y TE CONTACTAREMOS PARA CONFIRMAR.';
    bookingForm.reset();
    dateField.min = today;
    timeField.innerHTML = '<option value="">Primero elige día</option>';
    if (!document.querySelector('#agenda-content').hidden) loadAppointments();
  } catch (error) {
    bookingFeedback.textContent = error.message.includes('fetch') ? 'NO HAY CONEXIÓN. INTÉNTALO DE NUEVO EN UN MOMENTO.' : error.message.toUpperCase();
    bookingFeedback.classList.add('error');
  }
});

const agendaContent = document.querySelector('#agenda-content');
const adminLogin = document.querySelector('#admin-login');
const loginFeedback = document.querySelector('#login-feedback');
const adminDate = document.querySelector('#admin-date');
adminLogin.addEventListener('submit', async event => {
  event.preventDefault();
  loginFeedback.textContent = 'COMPROBANDO…';
  try {
    const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminLogin.elements.password.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo iniciar sesión.');
    adminLogin.hidden = true;
    agendaContent.hidden = false;
    loginFeedback.textContent = '';
    adminLogin.reset();
    await loadAppointments();
  } catch (error) { loginFeedback.textContent = error.message.toUpperCase(); }
});
document.querySelector('#admin-logout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  agendaContent.hidden = true;
  adminLogin.hidden = false;
  document.querySelector('#appointment-list').innerHTML = '<p class="empty-state">INICIA SESIÓN PARA VER LAS CITAS.</p>';
});
adminDate.addEventListener('change', loadAppointments);

async function loadAppointments() {
  if (agendaContent.hidden) return;
  const target = document.querySelector('#appointment-list');
  try {
    const suffix = adminDate.value ? `?date=${encodeURIComponent(adminDate.value)}` : '';
    const response = await fetch(`/api/appointments${suffix}`);
    const items = await response.json();
    if (response.status === 401) { agendaContent.hidden = true; adminLogin.hidden = false; return; }
    if (!response.ok) throw new Error(items.error || 'No se pudieron cargar las citas.');
    if (!items.length) { target.innerHTML = '<p class="empty-state">NO HAY CITAS PENDIENTES PARA ESTE DÍA.</p>'; return; }
    target.innerHTML = items.map(item => `<article class="appointment-card"><div class="appointment-time">${escapeHtml(item.time)}<small>${new Date(`${item.date}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</small></div><div class="appointment-detail">${escapeHtml(item.name)}<small>${escapeHtml(item.service)} · ${escapeHtml(item.phone)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div><button type="button" class="cancel-appointment" data-id="${escapeHtml(item.id)}">CANCELAR</button></article>`).join('');
    target.querySelectorAll('.cancel-appointment').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('¿Cancelar esta cita?')) return;
      const cancelled = await fetch(`/api/appointments/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
      if (cancelled.status === 401) { agendaContent.hidden = true; adminLogin.hidden = false; return; }
      await loadAppointments();
      if (dateField.value) refreshTimes();
    }));
  } catch (error) { target.innerHTML = `<p class="empty-state">${escapeHtml(error.message.toUpperCase())}</p>`; }
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
