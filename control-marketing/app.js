(() => {
  const $ = selector => document.querySelector(selector);
  const labels = {
    esencial: 'Aurora Esencial',
    explorador: 'Dúo Explorador',
    reserva: 'Reserva de la Casa',
    page_view: 'Visita',
    plan_selected: 'Selección de plan / CTA',
    checkout_started: 'Inicio de suscripción',
    checkout_abandoned: 'Abandono',
    subscription_confirmed: 'Suscripción confirmada',
    subscription_updated: 'Plan actualizado',
    subscription_cancelled: 'Plan cancelado',
    lead_captured: 'Lead capturado',
    session_end: 'Fin de sesión',
    cta_click: 'Clic en CTA',
    primary_cta_click: 'Clic en CTA principal',
    plans_section_view: 'Llegada a los planes',
    page_bottom_reached: 'Llegada al final de página',
    scroll_depth: 'Profundidad de scroll',
    faq_open: 'Pregunta frecuente abierta',
    subscription_modal_open: 'Modal de suscripción abierto',
    checkout_details_view: 'Paso de datos de envío',
    checkout_back_to_summary: 'Regreso al resumen',
    checkout_option_changed: 'Opción del plan cambiada',
    subscription_confirm_attempt: 'Intento de confirmar',
    cancel_confirmation_prompt: 'Alerta de cancelación',
    cancel_confirmation_confirmed: 'Aceptó en alerta de cancelación',
    cancel_confirmation_dismissed: 'Cancelación descartada'
  };
  const state = { user: null, section: 'dashboard', dashboard: null };
  const numberFormat = new Intl.NumberFormat('es-CO');
  const percentFormat = value => `${Number(value || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })}%`;
  const durationFormat = value => {
    const seconds = Math.round(Number(value) || 0);
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes} min ${remainingSeconds} s`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  };
  const formatDate = value => value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const formatMoney = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value) || 0);

  function showError(message) {
    const error = $('#pageError');
    error.textContent = message;
    error.classList.remove('hidden');
  }

  function clearError() {
    $('#pageError').classList.add('hidden');
    $('#pageError').textContent = '';
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      const body = contentType.includes('application/json') ? await response.json() : {};
      if (response.status === 401) showLogin();
      throw new Error(body.error || 'No se pudo completar la solicitud. Intenta de nuevo.');
    }
    return response;
  }

  async function jsonApi(path) {
    const response = await api(`/api/marketing/${path}`);
    return response.json();
  }

  function filterParams(extra = {}) {
    const params = new URLSearchParams({
      from: $('#dateFrom').value,
      to: $('#dateTo').value
    });
    for (const [key, selector] of Object.entries({
      source: '#filterSource',
      medium: '#filterMedium',
      campaign: '#filterCampaign'
    })) {
      const value = $(selector).value.trim();
      if (value) params.set(key, value);
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }

  function setDefaultDates() {
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - 29);
    const localDate = date => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    $('#dateFrom').value = localDate(from);
    $('#dateTo').value = localDate(today);
  }

  function showLogin() {
    $('#appView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
  }

  function showApp(user) {
    state.user = user;
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    $('#userEmail').textContent = user.email;
    $('#userRole').textContent = user.roleName;
    document.querySelectorAll('.side-nav button').forEach(button => {
      const allowed = user.permissions.includes(button.dataset.section);
      button.classList.toggle('hidden', !allowed);
      button.onclick = () => {
        if (allowed) selectSection(button.dataset.section);
      };
    });
    document.querySelectorAll('.export-button').forEach(button => {
      button.classList.toggle('hidden', !user.permissions.includes('reports'));
      button.onclick = () => exportCsv(button.dataset.export, button);
    });
    const firstSection = ['dashboard', 'campaigns', 'leads', 'events', 'subscriptions']
      .find(section => user.permissions.includes(section));
    selectSection(firstSection || 'dashboard');
  }

  function selectSection(section) {
    state.section = section;
    const title = {
      dashboard: 'Resumen general',
      campaigns: 'Campañas',
      leads: 'Visitantes y leads',
      events: 'Comportamiento',
      subscriptions: 'Suscripciones'
    }[section];
    $('#pageTitle').textContent = title;
    document.querySelectorAll('.side-nav button').forEach(button => button.classList.toggle('active', button.dataset.section === section));
    document.querySelectorAll('.page-section').forEach(panel => panel.classList.toggle('hidden', panel.id !== `section-${section}`));
    loadSection();
  }

  async function loadSection() {
    clearError();
    $('#loadingState').classList.remove('hidden');
    try {
      const params = filterParams();
      $('#rangeLabel').textContent = `${$('#dateFrom').value} — ${$('#dateTo').value}`;
      if (state.section === 'dashboard') await loadDashboard(params);
      if (state.section === 'campaigns') await loadCampaigns(params);
      if (state.section === 'leads') await loadLeads(params);
      if (state.section === 'events') await loadEvents(params);
      if (state.section === 'subscriptions') await loadSubscriptions(params);
    } catch (error) {
      showError(error.message);
    } finally {
      $('#loadingState').classList.add('hidden');
    }
  }

  async function loadDashboard(params) {
    const data = await jsonApi(`dashboard?${params}`);
    state.dashboard = data;
    $('#metricVisits').textContent = numberFormat.format(data.metrics.visits);
    $('#metricVisitors').textContent = numberFormat.format(data.metrics.visitors);
    $('#metricAvgDuration').textContent = data.metrics.measuredSessions
      ? durationFormat(data.metrics.avgDurationSeconds)
      : '—';
    $('#metricMeasuredSessions').textContent = `${numberFormat.format(data.metrics.measuredSessions)} sesiones con duración medida`;
    $('#metricPagesPerSession').textContent = data.metrics.visitors
      ? Number(data.metrics.pagesPerSession || 0).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
      : '—';
    $('#metricLeads').textContent = numberFormat.format(data.metrics.leads);
    $('#metricCta').textContent = numberFormat.format(data.metrics.ctaClicks);
    $('#metricStarts').textContent = numberFormat.format(data.metrics.checkoutStarts);
    $('#metricSubscriptions').textContent = numberFormat.format(data.metrics.subscriptions);
    $('#metricConversion').textContent = percentFormat(data.metrics.conversionRate);
    $('#metricCtr').textContent = percentFormat(data.metrics.ctaRate);
    $('#metricPrimaryCtaRate').textContent = percentFormat(data.metrics.primaryCtaRate);
    $('#metricPrimaryCtaClicks').textContent = `${numberFormat.format(data.metrics.primaryCtaClicks)} clics en el CTA principal`;
    $('#metricPlansReachRate').textContent = percentFormat(data.metrics.plansReachRate);
    $('#metricPlansSectionViews').textContent = `${numberFormat.format(data.metrics.plansSectionViews)} sesiones llegaron a planes`;
    $('#metricPageBottomRate').textContent = percentFormat(data.metrics.pageBottomRate);
    $('#metricPageBottomReaches').textContent = `${numberFormat.format(data.metrics.pageBottomReaches)} sesiones llegaron al cierre`;
    $('#metricModalOpens').textContent = numberFormat.format(data.metrics.modalOpens);
    $('#metricDetailsViews').textContent = `${numberFormat.format(data.metrics.detailsViews)} vistas del paso de envío`;
    $('#metricConfirmAbandonment').textContent = data.metrics.detailsViews
      ? percentFormat(data.metrics.confirmationAbandonmentRate)
      : '—';
    $('#metricConfirmAttempts').textContent = `${numberFormat.format(data.metrics.confirmAttempts)} intentos de confirmación`;
    $('#metricFaqOpens').textContent = numberFormat.format(data.metrics.faqOpens);
    $('#metricCancelPrompts').textContent = numberFormat.format(data.metrics.cancelPrompts);
    $('#metricCancelOutcomes').textContent = `${numberFormat.format(data.metrics.cancelConfirmed)} aceptadas · ${numberFormat.format(data.metrics.cancelDismissed)} descartadas`;
    $('#metricAbandonment').textContent = percentFormat(data.metrics.abandonmentRate);
    $('#metricAbandonmentCount').textContent = `${numberFormat.format(data.metrics.abandonments)} procesos identificados`;
    $('#metricCancellationRate').textContent = data.metrics.subscriptions
      ? percentFormat(data.metrics.cancellationRate)
      : '—';
    $('#metricCancellationCount').textContent = `${numberFormat.format(data.metrics.canceledSubscriptions)} solicitudes canceladas`;
    $('#metricNotCanceled').textContent = numberFormat.format(data.metrics.notCanceledSubscriptions);
    $('#leadConversionRate').textContent = percentFormat(data.metrics.leadConversionRate);
    drawTrend(data.timeseries);
    renderBars($('#sourceChart'), data.sources, row => row.source, row => row.visits);
    renderRank($('#planList'), data.plans, row => labels[row.planId] || row.planId, row => row.selections);
    renderRank($('#optionList'), data.options, row => `${row.bagSize || 'Tamaño sin dato'} · cada ${row.frequencyDays || '—'} días`, row => row.total);
    renderFunnel(data.funnel);
    renderFunnel(data.microFunnel, $('#microFunnelList'));
    renderRank($('#scrollDepthList'), data.scrollDepth, row => `${row.depth}% de scroll`, row => row.sessions);
    renderRank($('#optionSelectionList'), data.optionSelections, row => `${row.option === 'bagSize' ? 'Tamaño' : 'Frecuencia'}: ${row.value}`, row => row.total);
    renderRank($('#faqQuestionList'), data.faqQuestions, row => row.question, row => row.total);
  }

  function drawTrend(rows) {
    const canvas = $('#trendChart');
    const empty = $('#chartEmpty');
    const hasData = rows.some(row => row.visits || row.subscriptions);
    if (!hasData) {
      canvas.classList.add('hidden');
      empty.classList.add('visible');
      return;
    }
    const validRows = rows;
    canvas.classList.remove('hidden');
    empty.classList.remove('visible');
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(300, canvas.clientWidth);
    const height = 195;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const pad = { top: 13, right: 12, bottom: 28, left: 37 };
    const graphWidth = width - pad.left - pad.right;
    const graphHeight = height - pad.top - pad.bottom;
    const max = Math.max(1, ...validRows.map(row => Math.max(row.visits, row.subscriptions)));
    context.font = '9px Arial';
    context.textAlign = 'right';
    context.fillStyle = '#91897d';
    for (let tick = 0; tick <= 3; tick += 1) {
      const y = pad.top + graphHeight * tick / 3;
      context.strokeStyle = '#eee9e0';
      context.beginPath();
      context.moveTo(pad.left, y);
      context.lineTo(width - pad.right, y);
      context.stroke();
      context.fillText(numberFormat.format(Math.round(max * (1 - tick / 3))), pad.left - 7, y + 3);
    }
    const drawSeries = (key, color) => {
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      validRows.forEach((row, index) => {
        const x = pad.left + (validRows.length === 1 ? graphWidth / 2 : graphWidth * index / (validRows.length - 1));
        const y = pad.top + graphHeight * (1 - row[key] / max);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    };
    drawSeries('visits', '#68816b');
    drawSeries('subscriptions', '#bd744b');
    const labelCount = Math.min(5, validRows.length);
    context.fillStyle = '#91897d';
    context.textAlign = 'center';
    for (let index = 0; index < labelCount; index += 1) {
      const rowIndex = Math.round((validRows.length - 1) * index / Math.max(1, labelCount - 1));
      const row = validRows[rowIndex];
      const x = pad.left + (validRows.length === 1 ? graphWidth / 2 : graphWidth * rowIndex / (validRows.length - 1));
      context.fillText(new Date(`${row.day}T12:00:00`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }), x, height - 7);
    }
  }

  function renderBars(container, rows, label, value) {
    container.replaceChildren();
    const max = Math.max(1, ...rows.map(value));
    if (!rows.length) return appendEmpty(container, 'No hay visitas para mostrar.');
    rows.forEach(row => {
      const item = document.createElement('div');
      item.className = 'bar-row';
      const name = document.createElement('span');
      name.textContent = label(row);
      const track = document.createElement('span');
      track.className = 'bar-track';
      const fill = document.createElement('i');
      fill.style.width = `${Math.max(3, value(row) / max * 100)}%`;
      track.append(fill);
      const total = document.createElement('b');
      total.textContent = numberFormat.format(value(row));
      item.append(name, track, total);
      container.append(item);
    });
  }

  function renderRank(container, rows, label, value) {
    container.replaceChildren();
    if (!rows.length) return appendEmpty(container, 'Aún no hay datos para mostrar.');
    rows.forEach(row => {
      const item = document.createElement('div');
      item.className = 'rank-row';
      const name = document.createElement('span');
      name.textContent = label(row);
      const total = document.createElement('b');
      total.textContent = numberFormat.format(value(row));
      item.append(name, total);
      container.append(item);
    });
  }

  function renderFunnel(rows, container = $('#funnelList')) {
    container.replaceChildren();
    const max = Math.max(1, ...rows.map(row => row.total));
    rows.forEach(row => {
      const item = document.createElement('div');
      item.className = 'funnel-row';
      const name = document.createElement('span');
      name.textContent = row.step;
      const total = document.createElement('strong');
      total.textContent = numberFormat.format(row.total);
      const track = document.createElement('span');
      track.className = 'funnel-track';
      const fill = document.createElement('i');
      fill.style.width = `${row.total / max * 100}%`;
      track.append(fill);
      item.append(name, total, track);
      container.append(item);
    });
  }

  function appendEmpty(container, message, columns = 1) {
    const item = document.createElement('div');
    item.className = 'empty-row';
    item.colSpan = columns;
    item.textContent = message;
    container.append(item);
  }

  function renderTableRows(tbody, rows, columns, emptyMessage) {
    tbody.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('tr');
      const cell = document.createElement('td');
      cell.className = 'empty-row';
      cell.colSpan = columns.length;
      cell.textContent = emptyMessage;
      empty.append(cell);
      tbody.append(empty);
      return;
    }
    rows.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach(column => {
        const td = document.createElement('td');
        if (column.render) column.render(td, row);
        else td.textContent = row[column.key] == null || row[column.key] === '' ? '—' : row[column.key];
        tr.append(td);
      });
      tbody.append(tr);
    });
  }

  async function loadCampaigns(params) {
    const data = await jsonApi(`campaigns?${params}`);
    renderTableRows($('#campaignRows'), data.campaigns.map(row => ({
      ...row,
      conversion: row.visits ? row.subscriptions / row.visits * 100 : 0
    })), [
      { key: 'source' }, { key: 'medium' }, { key: 'campaign' },
      { key: 'term' }, { key: 'content' },
      { key: 'visits', render: (td, row) => { td.textContent = numberFormat.format(row.visits); } },
      { key: 'subscriptions', render: (td, row) => { td.textContent = numberFormat.format(row.subscriptions); } },
      { key: 'conversion', render: (td, row) => { td.textContent = percentFormat(row.conversion); } }
    ], 'No hay datos de campañas para este rango.');
  }

  async function loadLeads(params) {
    const search = $('#leadSearch').value.trim();
    if (search) params += `&search=${encodeURIComponent(search)}`;
    const data = await jsonApi(`leads?${params}`);
    $('#leadCount').textContent = `${data.leads.length} registros mostrados`;
    renderTableRows($('#leadRows'), data.leads, [
      { key: 'user_id', render: (td, row) => { td.textContent = row.user_id || 'Sin cuenta'; } },
      { key: 'name' }, { key: 'email' }, { key: 'phone' },
      { key: 'source' }, { key: 'campaign' },
      { key: 'created_at', render: (td, row) => { td.textContent = formatDate(row.created_at); } },
      { key: 'converted', render: (td, row) => {
        const badge = document.createElement('span');
        badge.className = `status-pill${row.converted ? '' : ' simulated'}`;
        badge.textContent = row.converted ? 'Convirtió' : 'Lead';
        td.append(badge);
      } }
    ], 'No se encontraron leads en el rango elegido.');
  }

  async function loadEvents(params) {
    const type = $('#eventType').value;
    if (type) params += `&event=${encodeURIComponent(type)}`;
    const data = await jsonApi(`events?${params}`);
    renderTableRows($('#eventRows'), data.events, [
      { key: 'event_name', render: (td, row) => { td.textContent = labels[row.event_name] || row.event_name; } },
      { key: 'email', render: (td, row) => {
        td.textContent = row.email || (row.session_id ? `${row.session_id.slice(0, 12)}…` : '—');
      } },
      { key: 'plan_id', render: (td, row) => {
        const previousPlan = row.previous_plan_name || labels[row.previous_plan_id] || '';
        const currentPlan = row.new_plan_name || row.plan_name || labels[row.plan_id] || row.plan_id || '';
        const previousOptions = [row.previous_bag_size, row.previous_frequency_days && `cada ${row.previous_frequency_days} días`].filter(Boolean).join(' · ');
        const currentOptions = [row.new_bag_size || row.bag_size, row.new_frequency_days || row.frequency_days ? `cada ${row.new_frequency_days || row.frequency_days} días` : ''].filter(Boolean).join(' · ');
        const previous = [previousPlan, previousOptions].filter(Boolean).join(' · ');
        const current = [currentPlan, currentOptions].filter(Boolean).join(' · ');
        td.textContent = row.event_name === 'subscription_updated' && previous
          ? `${previous} → ${current}`
          : current || previous || '—';
      } },
      { key: 'placement', render: (td, row) => {
        td.textContent = [
          row.placement && `Ubicación: ${row.placement}`,
          row.label && `CTA: ${row.label}`,
          row.option && `Opción: ${row.option} → ${row.value || '—'}`,
          row.depth && `Scroll: ${row.depth}%`,
          row.question && `FAQ: ${row.question}`,
          row.section && `Sección: ${row.section}`,
          row.mode && `Modal: ${row.mode}`,
          row.stage && `Paso: ${row.stage}`
        ].filter(Boolean).join(' · ') || '—';
      } },
      { key: 'duration_seconds', render: (td, row) => {
        td.textContent = row.duration_seconds == null ? '—' : durationFormat(row.duration_seconds);
      } },
      { key: 'campaign', render: (td, row) => { td.textContent = [row.source, row.medium, row.campaign, row.term, row.content].filter(Boolean).join(' · ') || '—'; } },
      { key: 'created_at', render: (td, row) => { td.textContent = formatDate(row.created_at); } }
    ], 'No hay interacciones para el filtro seleccionado.');
  }

  async function loadSubscriptions(params) {
    const plan = $('#subscriptionPlan').value;
    if (plan) params += `&plan=${encodeURIComponent(plan)}`;
    const data = await jsonApi(`subscriptions?${params}`);
    renderTableRows($('#subscriptionRows'), data.subscriptions, [
      { key: 'user_id', render: (td, row) => { td.textContent = row.user_id || 'Sin cuenta'; } },
      { key: 'customer_name' }, { key: 'email' },
      { key: 'plan_name', render: (td, row) => { td.textContent = row.plan_name || labels[row.plan_id] || '—'; } },
      { key: 'bag_size' },
      { key: 'frequency_days', render: (td, row) => { td.textContent = row.frequency_days ? `Cada ${row.frequency_days} días` : '—'; } },
      { key: 'price_cop', render: (td, row) => {
        const badge = document.createElement('span');
        badge.className = 'status-pill simulated';
        badge.textContent = formatMoney(row.price_cop);
        td.append(badge);
      } },
      { key: 'status', render: (td, row) => {
        const badge = document.createElement('span');
        const status = String(row.status || '').toLowerCase();
        const inactive = ['cancelada', 'vencida', 'inactiva', 'reemplazada'].includes(status);
        badge.className = `status-pill${inactive ? ' simulated' : ''}`;
        badge.textContent = ({ simulada: 'Activa', activa: 'Activa', active: 'Activa', cancelada: 'Cancelada', vencida: 'Vencida', inactiva: 'Inactiva', reemplazada: 'Reemplazada' })[status] || row.status || '—';
        td.append(badge);
      } },
      { key: 'source', render: (td, row) => { td.textContent = row.source || '—'; } },
      { key: 'medium', render: (td, row) => { td.textContent = row.medium || '—'; } },
      { key: 'campaign' }, { key: 'term' }, { key: 'content' },
      { key: 'created_at', render: (td, row) => { td.textContent = formatDate(row.created_at); } }
    ], 'No hay suscripciones para el rango elegido.');
  }

  async function exportCsv(type, button) {
    clearError();
    button.disabled = true;
    try {
      const extra = { type };
      if (type === 'leads' && $('#leadSearch').value.trim()) extra.search = $('#leadSearch').value.trim();
      if (type === 'events' && $('#eventType').value) extra.event = $('#eventType').value;
      if (type === 'subscriptions' && $('#subscriptionPlan').value) extra.plan = $('#subscriptionPlan').value;
      const params = new URLSearchParams(filterParams(extra));
      const response = await api(`/api/marketing/export?${params}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cafe-aurora-${type}-${$('#dateFrom').value}-${$('#dateTo').value}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      showError(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('#loginButton');
    const error = $('#loginError');
    error.textContent = '';
    button.disabled = true;
    const formData = new FormData(form);
    try {
      const response = await api('/api/marketing/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.get('email'), password: formData.get('password') })
      });
      const data = await response.json();
      form.reset();
      showApp(data.user);
    } catch (loginError) {
      error.textContent = loginError.message;
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    try {
      await api('/api/marketing/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      showLogin();
    } catch (error) {
      showError(error.message);
    }
  }

  $('#loginForm').addEventListener('submit', submitLogin);
  $('#applyFilters').addEventListener('click', loadSection);
  $('#eventType').addEventListener('change', loadSection);
  $('#subscriptionPlan').addEventListener('change', loadSection);
  $('#logoutButton').addEventListener('click', logout);
  let searchTimer;
  $('#leadSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (state.section === 'leads') loadSection();
    }, 250);
  });
  window.addEventListener('resize', () => {
    if (state.section === 'dashboard' && state.dashboard) drawTrend(state.dashboard.timeseries);
  });

  setDefaultDates();
  api('/api/marketing/session')
    .then(response => response.json())
    .then(data => showApp(data.user))
    .catch(error => {
      if (error.message !== 'Inicia sesión para continuar.' && !error.message.includes('sesión expiró')) {
        $('#loginError').textContent = error.message;
      }
      showLogin();
    });
})();
