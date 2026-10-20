// Anmelden, Registrieren (nur freigegebene E-Mails), Passwort vergessen / neu setzen.
import { $, h } from './dom.js';

const MSG = {
  'Invalid login credentials': 'E-Mail oder Passwort ist falsch.',
  'Email not confirmed': 'Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Mail).',
  'User already registered': 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.',
};
const nice = (e) => MSG[e?.message] || e?.message || String(e);

export function showAuth(backend, mode = 'login') {
  const root = $('#auth');
  root.style.backgroundImage = `url(${import.meta.env.BASE_URL}art/areale/wiese_route.webp)`;
  root.classList.remove('hidden');
  const card = h('form.auth-card', { onsubmit: (e) => e.preventDefault() });
  root.replaceChildren(card);
  const err = h('div.err');
  const field = (type, ph, ac) => h('input', { type, placeholder: ph, autocomplete: ac, required: true });
  const busy = async (btn, fn) => {
    err.textContent = ''; btn.disabled = true;
    try { await fn(); } catch (e) { err.textContent = nice(e); } finally { btn.disabled = false; }
  };
  const link = (text, m) => h('a', { onclick: () => showAuth(backend, m) }, text);
  card.append(h('h1', 'Freundesareale'));

  if (mode === 'login') {
    const email = field('email', 'E-Mail', 'email'), pw = field('password', 'Passwort', 'current-password');
    const btn = h('button.btn.primary.big', { type: 'submit' }, 'Anmelden');
    let remember = true;
    try { remember = localStorage.getItem('freundesareale.remember') !== '0'; } catch { /* ok */ }
    const rem = h('input', { type: 'checkbox', checked: remember });
    btn.onclick = () => busy(btn, () => backend.signIn(email.value.trim(), pw.value, rem.checked));
    card.append(h('p', 'Willkommen zurück!'), email, pw, h('label.remember', rem, ' Angemeldet bleiben'), err, btn, h('div.links', link('Konto erstellen', 'register'), link('Passwort vergessen?', 'forgot')));
  } else if (mode === 'register') {
    const email = field('email', 'E-Mail (muss freigegeben sein)', 'email'), pw = field('password', 'Passwort (mind. 8 Zeichen)', 'new-password'), pw2 = field('password', 'Passwort wiederholen', 'new-password');
    const btn = h('button.btn.primary.big', { type: 'submit' }, 'Konto erstellen');
    btn.onclick = () => busy(btn, async () => {
      if (pw.value.length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.');
      if (pw.value !== pw2.value) throw new Error('Die Passwörter stimmen nicht überein.');
      const r = await backend.signUp(email.value.trim(), pw.value);
      if (r.needsConfirmation) showAuth(backend, 'confirm');
    });
    card.append(h('p', 'Registrieren können sich nur freigegebene Personen.'), email, pw, pw2, err, btn, h('div.links', link('Zurück zur Anmeldung', 'login')));
  } else if (mode === 'confirm') {
    card.append(h('p.ok-msg', 'Fast geschafft! Wir haben dir eine E-Mail geschickt. Öffne den Link darin, dann kannst du dich anmelden.'), h('div.links', link('Zur Anmeldung', 'login')));
  } else if (mode === 'forgot') {
    const email = field('email', 'E-Mail', 'email');
    const btn = h('button.btn.primary', { type: 'submit' }, 'Link zum Zurücksetzen senden');
    btn.onclick = () => busy(btn, async () => {
      await backend.resetPassword(email.value.trim());
      card.replaceChildren(h('h1', 'Freundesareale'), h('p.ok-msg', 'Falls ein Konto existiert, ist eine E-Mail mit einem Link unterwegs. Über den Link kannst du ein neues Passwort setzen.'), h('div.links', link('Zur Anmeldung', 'login')));
    });
    card.append(h('p', 'Du bekommst einen Link per E-Mail.'), email, err, btn, h('div.links', link('Zurück', 'login')));
  } else if (mode === 'reset') {
    const pw = field('password', 'Neues Passwort (mind. 8 Zeichen)', 'new-password');
    const btn = h('button.btn.primary', { type: 'submit' }, 'Passwort speichern');
    btn.onclick = () => busy(btn, async () => {
      if (pw.value.length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.');
      await backend.updatePassword(pw.value);
      root.dispatchEvent(new CustomEvent('password-updated'));
    });
    card.append(h('p', 'Lege ein neues Passwort fest.'), pw, err, btn);
  }
}

export const hideAuth = () => $('#auth').classList.add('hidden');
