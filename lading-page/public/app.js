(() => {
  const apiUrl = path => path;
  const plans = {
    esencial: { name: 'Aurora Esencial', description: 'Tu primer encuentro con el café de especialidad.', base: 39900, baseSize: '250 g' },
    explorador: { name: 'Dúo Explorador', description: 'Dos perfiles para descubrir nuevos favoritos.', base: 69900, baseSize: '500 g' },
    reserva: { name: 'Reserva de la Casa', description: 'Para quienes hacen del café su gran ritual.', base: 109900, baseSize: '1 kg' }
  };
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const $ = selector => document.querySelector(selector);
  const checkout = $('#checkout');
  const sessionId = getSessionId();
  const params = new URLSearchParams(location.search);
  if (!sessionStorage.getItem('aurora_attribution')) {
    sessionStorage.setItem('aurora_attribution', JSON.stringify({
      source: params.get('utm_source') || (params.has('gclid') ? 'google' : params.has('fbclid') ? 'facebook' : 'direct'),
      medium: params.get('utm_medium') || '',
      campaign: params.get('utm_campaign') || '',
      term: params.get('utm_term') || '',
      content: params.get('utm_content') || '',
      gclid: params.get('gclid') || '',
      fbclid: params.get('fbclid') || ''
    }));
  }
  const attribution = JSON.parse(sessionStorage.getItem('aurora_attribution'));
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
    const now = Date.now();
    let id = sessionStorage.getItem('aurora_session');
    const startedAt = Number(sessionStorage.getItem('aurora_session_started_at'));
    const lastActivityAt = Number(sessionStorage.getItem('aurora_session_last_activity_at'));
    if (!id || !Number.isFinite(startedAt) || !lastActivityAt || now - lastActivityAt > SESSION_TIMEOUT_MS) {
      id = crypto.randomUUID ? crypto.randomUUID() : `s-${now}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('aurora_session', id);
      sessionStorage.setItem('aurora_session_started_at', String(now));
    }
    sessionStorage.setItem('aurora_session_last_activity_at', String(now));
    return id;
  }
  const sessionStartedAt = Number(sessionStorage.getItem('aurora_session_started_at'));
  let sessionEndSent = false;
  let lastActivityWriteAt = 0;
  function recordActivity() {
    const now = Date.now();
    if (now - lastActivityWriteAt < 30000) return;
    lastActivityWriteAt = now;
    sessionStorage.setItem('aurora_session_last_activity_at', String(now));
  }
  document.addEventListener('pointerdown', recordActivity, { passive: true });
  document.addEventListener('keydown', recordActivity);
  document.addEventListener('scroll', recordActivity, { passive: true });
  function track(eventName, planId = '', metadata = {}) {
    recordActivity();
    const payload = { sessionId, eventName, pagePath: location.pathname, planId, ...attribution, metadata };
    fetch(apiUrl('/api/events'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
  }
  function endSession() {
    if (sessionEndSent) return;
    sessionEndSent = true;
    const durationSeconds = Math.min(86400, Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000)));
    const payload = {
      sessionId,
      eventName: 'session_end',
      pagePath: location.pathname,
      ...attribution,
      metadata: { durationSeconds }
    };
    const body = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (!navigator.sendBeacon(apiUrl('/api/events'), body)) {
      fetch(apiUrl('/api/events'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(() => {});
    }
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
    track('subscription_modal_open', selectedPlan, {
      mode: subscriptionMode,
      bagSize: $('#bagSize').value,
      frequencyDays: document.querySelector('input[name="frequency"]:checked').value
    });
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
      track('subscription_confirmed', selectedPlan, {
        subscriptionId: subscription.id,
        source: attribution.source,
        medium: attribution.medium,
        campaign: attribution.campaign,
        term: attribution.term,
        content: attribution.content,
        gclid: attribution.gclid,
        fbclid: attribution.fbclid
      });
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
    const response = await fetch(apiUrl('/api/auth/me'), { credentials: 'include', cache: 'no-store' });
    const result = await response.json();
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(result.error || 'No se pudo verificar la sesión.');
    const customer = { ...result.user, activeSubscription: result.activeSubscription || null };
    setAuthenticatedCustomer(customer);
    return customer;
  }
  async function checkCustomerSession() {
    try {
      const response = await fetch(apiUrl('/api/auth/me'), { credentials: 'include', cache: 'no-store' });
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
    else if (checkoutStarted) {
      const stage = $('#stepDetails').classList.contains('hidden') ? 'summary' : 'details';
      track('checkout_abandoned', selectedPlan, { stage });
      checkoutStarted = false;
    }
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
    if (!activeSubscription) return;
    track('cancel_confirmation_prompt', activeSubscription.plan_id);
    const confirmed = window.confirm('¿Quieres cancelar tu plan activo ahora?');
    track(confirmed ? 'cancel_confirmation_confirmed' : 'cancel_confirmation_dismissed', activeSubscription.plan_id);
    if (!confirmed) return;
    button.disabled = true;
    try {
      const response = await fetch(apiUrl('/api/subscriptions/active/cancel'), {
        method: 'POST',
        credentials: 'include',
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
  $('#bagSize').addEventListener('change', event => {
    updateSummary();
    track('checkout_option_changed', selectedPlan, { option: 'bagSize', value: event.currentTarget.value });
  });
  document.querySelectorAll('input[name="frequency"]').forEach(input => input.addEventListener('change', event => {
    updateSummary();
    track('checkout_option_changed', selectedPlan, { option: 'frequencyDays', value: event.currentTarget.value });
  }));
  document.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
  $('#toDetails').addEventListener('click', () => {
    track('checkout_details_view', selectedPlan, { bagSize: $('#bagSize').value, frequencyDays: document.querySelector('input[name="frequency"]:checked').value });
    $('#stepSummary').classList.add('hidden'); $('#stepDetails').classList.remove('hidden'); $('#progressFill').style.width = '100%';
  });
  $('#backSummary').addEventListener('click', () => { track('checkout_back_to_summary', selectedPlan); $('#stepDetails').classList.add('hidden'); $('#stepSummary').classList.remove('hidden'); $('#progressFill').style.width = '50%'; });
  $('.close-checkout').addEventListener('click', closeCheckout);
  checkout.addEventListener('click', event => { if (event.target === checkout) closeCheckout(); });
  $('#finishCheckout').addEventListener('click', () => { closeCheckout(); location.hash = '#inicio'; });
  $('#submitSubscription').addEventListener('click', () => track('subscription_confirm_attempt', selectedPlan, {
    bagSize: $('#bagSize').value,
    frequencyDays: document.querySelector('input[name="frequency"]:checked').value
  }));
  document.querySelectorAll('.desktop-nav a[href="#planes"], a[href="#planes"]').forEach(link => {
    link.addEventListener('click', () => {
      const placement = link.closest('.hero-actions') ? 'hero'
        : link.closest('.site-header') ? 'header'
          : link.closest('.closing-cta') ? 'closing'
            : 'content';
      track('cta_click', '', { placement, label: link.textContent.trim().slice(0, 100) });
      if (placement === 'hero') track('primary_cta_click', '', { placement });
    });
  });
  document.querySelectorAll('.faq-list details').forEach((item, index) => {
    item.addEventListener('toggle', () => {
      if (item.open) track('faq_open', '', { questionIndex: index + 1, question: item.querySelector('summary').textContent.trim().slice(0, 160) });
    });
  });
  document.querySelectorAll('#planes, .closing-cta').forEach(section => {
    const eventName = section.id === 'planes' ? 'plans_section_view' : 'page_bottom_reached';
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        track(eventName, '', { section: section.id || 'closing-cta' });
        observer.disconnect();
      }
    }, { threshold: 0.25 });
    observer.observe(section);
  });
  const scrollDepths = new Set();
  function recordScrollDepth() {
    const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollableHeight <= 0) return;
    const depth = Math.min(100, Math.floor(window.scrollY / scrollableHeight * 100));
    for (const threshold of [25, 50, 75, 100]) {
      if (depth >= threshold && !scrollDepths.has(threshold)) {
        scrollDepths.add(threshold);
        track('scroll_depth', '', { depth: threshold });
      }
    }
  }
  window.addEventListener('scroll', recordScrollDepth, { passive: true });

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
        const authResponse = await fetch(apiUrl(`/api/auth/${authMode}`), {
          method: 'POST',
          credentials: 'include',
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
        const profileResponse = await fetch(apiUrl('/api/auth/profile'), {
          method: 'PUT',
          credentials: 'include',
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
        source: attribution.source,
        medium: attribution.medium,
        campaign: attribution.campaign,
        term: attribution.term,
        content: attribution.content,
        gclid: attribution.gclid,
        fbclid: attribution.fbclid
      };
      const updating = subscriptionMode === 'update';
      const response = await fetch(apiUrl(updating ? '/api/subscriptions/active' : '/api/subscriptions'), {
        method: updating ? 'PUT' : 'POST',
        credentials: 'include',
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
      const response = await fetch(apiUrl('/api/leads'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, consent: true, offer: 'guia-preparacion', ...attribution }) });
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
  window.addEventListener('pagehide', endSession);
  checkCustomerSession();
})();
