import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = window.SUPABASE_URL || '';
const supabaseKey = window.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials not found');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const $ = (id) => document.getElementById(id);
const showError = (msg) => {
  const err = $('error');
  if (err) {
    err.textContent = msg;
    err.style.display = 'block';
  }
};
const hideError = () => {
  const err = $('error');
  if (err) err.style.display = 'none';
};

function showToast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

const loginForm = $('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    
    const email = $('email').value.trim();
    const password = $('password').value;
    
    const btn = $('loginBtn');
    btn.disabled = true;
    btn.textContent = 'Logging in...';
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) throw error;
      
      if (data.session) {
        await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            access_token: data.session.access_token,
            user: data.user 
          }),
        });
        
        showToast('Login successful!');
        setTimeout(() => window.location.href = '/', 500);
      }
    } catch (err) {
      showError(err.message || 'Login failed');
      btn.disabled = false;
      btn.textContent = 'Login';
    }
  });
}

const signupForm = $('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    
    const name = $('name').value.trim();
    const email = $('email').value.trim();
    const password = $('password').value;
    
    if (password.length < 6) {
      showError('Password must be at least 6 characters');
      return;
    }
    
    const btn = $('signupBtn');
    btn.disabled = true;
    btn.textContent = 'Creating account...';
    
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
          }
        }
      });
      
      if (error) throw error;
      
      if (data.session) {
        await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            access_token: data.session.access_token,
            user: data.user 
          }),
        });
        
        showToast('Account created!');
        setTimeout(() => window.location.href = '/', 500);
      } else {
        showToast('Check your email to confirm your account');
        setTimeout(() => window.location.href = '/login.html', 2000);
      }
    } catch (err) {
      showError(err.message || 'Signup failed');
      btn.disabled = false;
      btn.textContent = 'Sign Up';
    }
  });
}
