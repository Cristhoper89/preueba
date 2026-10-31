(() => {
  const plans = {
    esencial: { name: 'Aurora Esencial', description: 'Tu primer encuentro con el café de especialidad.', base: 39900, baseSize: '250 g' },
    explorador: { name: 'Dúo Explorador', description: 'Dos perfiles para descubrir nuevos favoritos.', base: 69900, baseSize: '500 g' },
    reserva: { name: 'Reserva de la Casa', description: 'Para quienes hacen del café su gran ritual.', base: 109900, baseSize: '1 kg' }
  };
  const $ = selector => document.querySelector(selector);
  const checkout = $('#checkout');
  const sessionId = getSessionId();
  const params = new URLSearchParams(location.search);
  const attribution = {
    source: params.get('utm_source') || (params.has('gclid') ? 'google' : params.has('fbclid') ? 'facebook' : 'direct'),
    medium: params.get('utm_medium') || '',
    campaign: params.get('utm_campaign') || '',
    gclid: params.get('gclid') || '',
    fbclid: params.get('fbclid') || ''
  };
  let selectedPlan = 'explorador';
  let checkoutStarted = false;
  let subscriptionMode = 'create';
  let authMode = 'register';
  let authenticatedCustomer = null;
  let activeSubscription = null;
  let customerSessionChecked = false;
  let customerSignedIn = true;
  let exitModalShown = sessionStorage.getItem('aurora_exit_shown') === '1';
  const formatCOP = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
  const priceFor = () => {
    const factors = { '250 g': 1, '500 g': 1.7, '1 kg': 2.8 };
    return Math.round((plans[selectedPlan].base * factors[$('#bagSize').value] / factors[plans[selectedPlan].baseSize]) / 100) * 100;
  };
  function getSessionId() {
    let id = sessionStorage.getItem('aurora_session');
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`); sessionStorage.setItem('aurora_session', id); }
    return id;
  }
  function track(eventName, planId = '', metadata = {}) {
    const payload = { sessionId, eventName, pagePath: location.pathname, planId, ...attribution, metadata };
    fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
  }
  function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3000); }
  function updateSummary() {
    $('#summaryName').textContent = plans[selectedPlan].name;
    $('#summaryDescription').textContent = plans[selectedPlan].description;
    $('#summaryPrice').textContent = formatCOP(priceFor());
    $('#detailsPrice').textContent = formatCOP(priceFor());
  }
  function openCheckout(planId) {
    subscriptionMode = customerSignedIn && activeSubscription ? 'update' : 'create';
    selectedPlan = plans[planId] ? planId : 'explorador';
    $('#bagSize').value = selectedPlan === 'esencial' ? '250 g' : selectedPlan === 'reserva' ? '1 kg' : '500 g';
    updateSummary();
    $('#stepSummary').classList.remove('hidden'); $('#stepDetails').classList.add('hidden'); $('#stepDone').classList.add('hidden');
    $('#detailsTitle').innerHTML = subscriptionMode === 'update'
      ? 'Actualiza tu<br><em>plan Aurora.</em>'
      : '¿A dónde<br>lo <em>enviamos?</em>';
    $('#detailsIntro').textContent = subscriptionMode === 'update'
      ? 'Elige el tamaño y la frecuencia de tu nuevo plan.'
      : 'Crea una cuenta o inicia sesión para confirmar tu suscripción.';
    $('#submitSubscription').innerHTML = subscriptionMode === 'update'
      ? 'Actualizar plan <span>→</span>'
      : 'Confirmar suscripción <span>→</span>';
    $('#progressFill').style.width = '50%';
    checkout.classList.add('open'); checkout.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    track('plan_selected', selectedPlan);
    if (!checkoutStarted) { track('checkout_started', selectedPlan); checkoutStarted = true; }
    $('.close-checkout').focus();
  }
  function showConfirmation(subscription, customer) {
    selectedPlan = plans[subscription.plan_id] ? subscription.plan_id : selectedPlan;
    $('#bagSize').value = subscription.bag_size;
    const frequency = document.querySelector(`input[name="frequency"][value="${subscription.frequency_days}"]`);
    if (frequency) frequency.checked = true;
    updateSummary();
    $('#confirmationNumber').textContent = `CA-${String(subscription.id).padStart(6, '0')}`;
    $('#confirmationText').textContent = `${subscription.plan_name} · ${subscription.bag_size} · cada ${subscription.frequency_days} días · ${formatCOP(Number(subscription.price_cop))} por entrega.`;
    $('#confirmationAccount').textContent = `${customer.name} · ${customer.email}`;
    $('#stepSummary').classList.add('hidden');
    $('#stepDetails').classList.add('hidden');
    $('#stepDone').classList.remove('hidden');
    $('#progressFill').style.width = '100%';
    checkout.classList.add('open');
    checkout.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    resetAuthForm();
    checkoutStarted = false;
    if (subscriptionMode !== 'update') {
      track('subscription_confirmed', selectedPlan, { subscriptionId: subscription.id });
    }
  }
  function setAuthMode(mode) {
    authMode = mode;
    $('#nameField').hidden = mode !== 'register';
    $('#nameField').querySelector('input').required = mode === 'register';
    $('#passwordConfirmationField').hidden = mode !== 'register';
    $('#passwordConfirmationField').querySelector('input').required = mode === 'register';
    $('#deliveryFields').hidden = mode !== 'register';
    $('#deliveryFields').querySelectorAll('input').forEach(input => { input.required = mode === 'register'; });
    $('#accountFields').querySelector('[name="password"]').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('#accountFields').querySelector('[name="passwordConfirmation"]').value = '';
    $('#authNote').textContent = mode === 'register'
      ? 'Guardaremos tu teléfono, ciudad y dirección en tu cuenta para futuras suscripciones.'
      : 'Usaremos los datos de entrega guardados en tu cuenta para esta suscripción.';
    document.querySelectorAll('[data-auth-mode]').forEach(button => {
      const selected = button.dataset.authMode === mode;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  function setAuthenticatedCustomer(customer) {
    authenticatedCustomer = customer;
    customerSignedIn = true;
    customerSessionChecked = true;
    activeSubscription = customer.activeSubscription || null;
    renderPlanActions();
    leadModal.classList.remove('open');
    leadModal.setAttribute('aria-hidden', 'true');
    $('#authMode').classList.add('hidden');
    $('#accountFields').classList.add('hidden');
    $('#accountFields').querySelectorAll('input').forEach(input => {
      input.disabled = true;
      if (input.type === 'password') input.value = '';
    });
    const profileComplete = customer.profileComplete !== false;
    $('#deliveryFields').hidden = profileComplete;
    $('#deliveryFields').querySelectorAll('input').forEach(input => {
      input.disabled = profileComplete;
      input.required = !profileComplete;
    });
    $('#accountStatus').textContent = profileComplete
      ? `Sesión iniciada: ${customer.name} · ${customer.email}`
      : `Sesión iniciada: ${customer.name} · Completa los datos de entrega de tu perfil una sola vez.`;
    $('#accountStatus').classList.remove('hidden');
    $('#authNote').textContent = 'Usaremos los datos de entrega guardados en tu cuenta. No se solicitan datos de tarjeta.';
  }
  function resetAuthForm() {
    authenticatedCustomer = null;
    $('#authMode').classList.remove('hidden');
    $('#accountFields').classList.remove('hidden');
    $('#accountStatus').classList.add('hidden');
    $('#accountStatus').textContent = '';
    $('#accountFields').querySelectorAll('input').forEach(input => {
      input.disabled = false;
      if (input.type === 'password') input.value = '';
    });
    $('#deliveryFields').querySelectorAll('input').forEach(input => {
      input.disabled = false;
      input.value = '';
    });
    setAuthMode('register');
  }
  async function getAuthenticatedCustomer() {
    if (authenticatedCustomer) return authenticatedCustomer;
    const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    const result = await response.json();
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(result.error || 'No se pudo verificar la sesión.');
    const customer = { ...result.user, activeSubscription: result.activeSubscription || null };
    setAuthenticatedCustomer(customer);
    return customer;
  }
  async function checkCustomerSession() {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) {
        customerSignedIn = false;
        return;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo verificar la sesión.');
      setAuthenticatedCustomer({ ...result.user, activeSubscription: result.activeSubscription || null });
    } catch (error) {
      console.error(`customer session check failed: ${error.message}`);
    } finally {
      customerSessionChecked = true;
    }
  }
  function closeCheckout() {
    if (checkout.classList.contains('open') && !$('#stepDone').classList.contains('hidden')) { /* completed */ }
    else if (checkoutStarted) { track('checkout_abandoned', selectedPlan); checkoutStarted = false; }
    checkout.classList.remove('open'); checkout.setAttribute('aria-hidden', 'true'); document.body.style.overflow = '';
  }
  function renderPlanActions() {
    const hasActiveSubscription = customerSignedIn && Boolean(activeSubscription);
    document.querySelectorAll('.plan-card').forEach(card => {
      const currentPlan = hasActiveSubscription && card.dataset.plan === activeSubscription.plan_id;
      card.classList.toggle('is-active-plan', currentPlan);
      const tag = card.querySelector('.plan-tag');
      tag.textContent = currentPlan ? 'TU PLAN ACTUAL' : tag.dataset.defaultTag;
      const chooseButton = card.querySelector('.choose-plan');
      chooseButton.firstChild.textContent = hasActiveSubscription ? 'Actualizar plan ' : 'Elegir este plan ';
      card.querySelector('.cancel-plan').classList.toggle('hidden', !currentPlan);
    });
  }
  async function cancelActiveSubscription(button) {
    if (!activeSubscription || !window.confirm('¿Quieres cancelar tu plan activo ahora?')) return;
    button.disabled = true;
    try {
      const response = await fetch('/api/subscriptions/active/cancel', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo cancelar el plan.');
      activeSubscription = null;
      renderPlanActions();
      toast('Tu plan quedó cancelado.');
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }
  document.querySelectorAll('.choose-plan').forEach(button => button.addEventListener('click', () => openCheckout(button.dataset.plan)));
  document.querySelectorAll('.cancel-plan').forEach(button => button.addEventListener('click', () => cancelActiveSubscription(button)));
  $('#bagSize').addEventListener('change', updateSummary);
  document.querySelectorAll('input[name="frequency"]').forEach(input => input.addEventListener('change', updateSummary));
  document.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
  $('#toDetails').addEventListener('click', () => { $('#stepSummary').classList.add('hidden'); $('#stepDetails').classList.remove('hidden'); $('#progressFill').style.width = '100%'; });
  $('#backSummary').addEventListener('click', () => { $('#stepDetails').classList.add('hidden'); $('#stepSummary').classList.remove('hidden'); $('#progressFill').style.width = '50%'; });
  $('.close-checkout').addEventListener('click', closeCheckout);
  checkout.addEventListener('click', event => { if (event.target === checkout) closeCheckout(); });
  $('#finishCheckout').addEventListener('click', () => { closeCheckout(); location.hash = '#inicio'; });

  $('#subscriptionForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $('#formError'); error.textContent = '';
    const button = $('#submitSubscription'); button.disabled = true; button.textContent = 'Procesando…';
    try {
      let customer = await getAuthenticatedCustomer();
      if (!customer) {
        if (!form.reportValidity()) return;
        const data = Object.fromEntries(new FormData(form).entries());
        if (authMode === 'register' && data.password !== data.passwordConfirmation) {
          error.textContent = 'Las contraseñas no coinciden.';
          return;
        }
        const authResponse = await fetch(`/api/auth/${authMode}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            email: data.email,
            password: data.password,
            passwordConfirmation: data.passwordConfirmation,
            ...(authMode === 'register' ? { phone: data.phone, city: data.city, address: data.address } : {})
          })
        });
        const authResult = await authResponse.json();
        if (!authResponse.ok) throw new Error(authResult.error || 'No se pudo autenticar la cuenta.');
        customer = { ...authResult.user, activeSubscription: authResult.activeSubscription || null };
        setAuthenticatedCustomer(customer);
      }
      subscriptionMode = activeSubscription ? 'update' : 'create';
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      if (!customer.profileComplete) {
        const profileResponse = await fetch('/api/auth/profile', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: data.phone, city: data.city, address: data.address })
        });
        const profileResult = await profileResponse.json();
        if (!profileResponse.ok) throw new Error(profileResult.error || 'No se pudieron guardar los datos de entrega.');
        customer.profileComplete = profileResult.profileComplete;
        setAuthenticatedCustomer(customer);
      }
      const order = {
        termsAccepted: form.elements.termsAccepted.checked,
        planId: selectedPlan,
        bagSize: $('#bagSize').value,
        frequencyDays: Number(document.querySelector('input[name="frequency"]:checked').value),
        ...attribution
      };
      const updating = subscriptionMode === 'update';
      const response = await fetch(updating ? '/api/subscriptions/active' : '/api/subscriptions', {
        method: updating ? 'PUT' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo registrar la suscripción.');
      if (!result.subscription) throw new Error('No se recibió la confirmación de la suscripción.');
      activeSubscription = result.subscription;
      renderPlanActions();
      showConfirmation(result.subscription, result.customer || customer);
    } catch (err) { error.textContent = err.message; }
    finally {
      button.disabled = false;
      button.innerHTML = subscriptionMode === 'update' ? 'Actualizar plan <span>→</span>' : 'Confirmar suscripción <span>→</span>';
    }
  });

  const leadModal = $('#leadModal');
  function showLeadModal() {
    if (!customerSessionChecked || customerSignedIn || exitModalShown || sessionStorage.getItem('aurora_lead_dismissed') === '1') return;
    exitModalShown = true; sessionStorage.setItem('aurora_exit_shown', '1'); leadModal.classList.add('open'); leadModal.setAttribute('aria-hidden', 'false');
  }
  document.addEventListener('mouseout', event => { if (event.clientY <= 0 && event.relatedTarget == null) showLeadModal(); });
  $('.lead-close').addEventListener('click', () => { leadModal.classList.remove('open'); leadModal.setAttribute('aria-hidden', 'true'); sessionStorage.setItem('aurora_lead_dismissed', '1'); });
  leadModal.addEventListener('click', event => { if (event.target === leadModal) { leadModal.classList.remove('open'); sessionStorage.setItem('aurora_lead_dismissed', '1'); } });
  $('#leadForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    const error = $('#leadError'); error.textContent = '';
    const email = new FormData(form).get('email');
    try {
      const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, consent: true, offer: 'guia-preparacion', ...attribution }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pudo guardar tu correo.');
      if (result.captured === false) {
        error.textContent = result.message || 'No se registró el lead.';
        return;
      }
      track('lead_captured'); leadModal.classList.remove('open'); leadModal.setAttribute('aria-hidden', 'true'); sessionStorage.setItem('aurora_lead_dismissed', '1'); toast('¡Gracias! Tu correo quedó registrado.'); form.reset();
    } catch (err) { error.textContent = err.message; }
  });

  const menuButton = $('.menu-toggle');
  menuButton.addEventListener('click', () => { const nav = $('.desktop-nav'); const open = nav.classList.toggle('mobile-open'); menuButton.setAttribute('aria-expanded', String(open)); });
  document.querySelectorAll('.desktop-nav a').forEach(link => link.addEventListener('click', () => { $('.desktop-nav').classList.remove('mobile-open'); menuButton.setAttribute('aria-expanded', 'false'); }));
  $('#year').textContent = new Date().getFullYear();
  track('page_view', '', { referrer: document.referrer || 'direct' });
  checkCustomerSession();
})();
