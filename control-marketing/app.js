(() => {
  const $ = selector => document.querySelector(selector);
  const labels = {
    esencial: 'Aurora Esencial',
    explorador: 'Dúo Explorador',
    reserva: 'Reserva de la Casa',
    page_view: 'Visita',
    plan_selected: 'Selección de plan',
    checkout_started: 'Inicio de suscripción',
    checkout_abandoned: 'Abandono',
    subscription_confirmed: 'Suscripción confirmada',
    subscription_updated: 'Plan actualizado',
    subscription_cancelled: 'Plan cancelado',
    lead_captured: 'Contacto registrado',
    session_end: 'Fin de sesión',
    cta_click: 'Clic en botón',
    primary_cta_click: 'Clic en botón principal',
    faq_open: 'Pregunta frecuente abierta',
    subscription_modal_open: 'Ventana de suscripción abierta',
    checkout_details_view: 'Paso de datos de envío',
    checkout_back_to_summary: 'Regreso al resumen',
    checkout_option_changed: 'Opción del plan cambiada',
    subscription_confirm_attempt: 'Intento de confirmar',
    cancel_confirmation_prompt: 'Alerta de cancelación',
    cancel_confirmation_confirmed: 'Aceptó en alerta de cancelación',
    cancel_confirmation_dismissed: 'Cancelación descartada'
  };
  const state = { user: null, section: 'dashboard', dashboard: null, filterDimensions: [], filterRange: '' };
  let chartHoverIndex = null;
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

  function renderDimensionOptions(select, placeholder, values, selectedValue) {
    select.replaceChildren(new Option(placeholder, ''));
    for (const value of values) select.add(new Option(value, value));
    select.value = values.includes(selectedValue) ? selectedValue : '';
  }

  function updateDimensionOptions() {
    const source = $('#filterSource').value;
    const medium = $('#filterMedium').value;
    const mediums = [...new Set(state.filterDimensions
      .filter(row => !source || row.source === source)
      .map(row => row.medium)
      .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    renderDimensionOptions($('#filterMedium'), 'Todos los medios', mediums, medium);

    const campaigns = [...new Set(state.filterDimensions
      .filter(row => (!source || row.source === source) && (!$('#filterMedium').value || row.medium === $('#filterMedium').value))
      .map(row => row.campaign)
      .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    renderDimensionOptions($('#filterCampaign'), 'Todas las campañas', campaigns, $('#filterCampaign').value);
  }

  async function loadFilterDimensions() {
    const range = `${$('#dateFrom').value}|${$('#dateTo').value}`;
    if (state.filterRange === range) return;
    const params = new URLSearchParams({ from: $('#dateFrom').value, to: $('#dateTo').value });
    const data = await jsonApi(`filter-options?${params}`);
    state.filterDimensions = data.dimensions;
    state.filterRange = range;
    const selectedSource = $('#filterSource').value;
    const sources = [...new Set(state.filterDimensions.map(row => row.source).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'));
    renderDimensionOptions($('#filterSource'), 'Todas las fuentes', sources, selectedSource);
    updateDimensionOptions();
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
      leads: 'Contactos',
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
      await loadFilterDimensions();
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
    $('#comparisonCaption').textContent = `Comparado con ${data.previousRange.from} — ${data.previousRange.to} (período anterior de igual duración).`;
    $('#metricVisits').textContent = numberFormat.format(data.metrics.visits);
    $('#metricVisitors').textContent = numberFormat.format(data.metrics.visitors);
    $('#metricAvgDuration').textContent = data.metrics.measuredSessions
      ? durationFormat(data.metrics.avgDurationSeconds)
      : '—';
    $('#metricMeasuredSessions').textContent = `${numberFormat.format(data.metrics.measuredSessions)} visitas con duración registrada`;
    $('#metricLeads').textContent = numberFormat.format(data.metrics.leads);
    $('#metricCta').textContent = numberFormat.format(data.metrics.ctaClicks);
    $('#metricStarts').textContent = numberFormat.format(data.metrics.checkoutStarts);
    $('#metricSubscriptions').textContent = numberFormat.format(data.metrics.subscriptions);
    $('#metricConversion').textContent = percentFormat(data.metrics.conversionRate);
    $('#metricCtr').textContent = percentFormat(data.metrics.ctaRate);
    $('#metricPrimaryCtaRate').textContent = percentFormat(data.metrics.primaryCtaRate);
    $('#metricPrimaryCtaClicks').textContent = `${numberFormat.format(data.metrics.primaryCtaClicks)} clics en el botón principal`;
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
    $('#metricAbandonmentCount').textContent = `${numberFormat.format(data.metrics.abandonments)} procesos sin finalizar`;
    $('#metricCancellationRate').textContent = data.metrics.subscriptions
      ? percentFormat(data.metrics.cancellationRate)
      : '—';
    $('#metricCancellationCount').textContent = `${numberFormat.format(data.metrics.canceledSubscriptions)} solicitudes canceladas`;
    $('#metricNotCanceled').textContent = numberFormat.format(data.metrics.notCanceledSubscriptions);
    $('#leadConversionRate').textContent = percentFormat(data.metrics.leadConversionRate);
    renderComparison('trendVisits', data.metrics.visits, data.previousMetrics.visits);
    renderComparison('trendSubscriptions', data.metrics.subscriptions, data.previousMetrics.subscriptions);
    renderComparison('trendConversion', data.metrics.conversionRate, data.previousMetrics.conversionRate, 'percentage-points');
    renderComparison('trendLeads', data.metrics.leads, data.previousMetrics.leads);
    drawTrend(data.timeseries);
    renderBars($('#sourceChart'), data.sources, row => row.source, row => row.visits);
    renderRank($('#planList'), data.plans, row => labels[row.planId] || row.planId, row => row.selections);
    renderRank($('#optionList'), data.options, row => `${row.bagSize || 'Tamaño sin dato'} · cada ${row.frequencyDays || '—'} días`, row => row.total);
    renderFunnel(data.funnel);
    renderFunnel(data.microFunnel, $('#microFunnelList'));
    renderRank($('#optionSelectionList'), data.optionSelections, row => `${row.option === 'bagSize' ? 'Tamaño' : 'Frecuencia'}: ${row.value}`, row => row.total);
    renderRank($('#faqQuestionList'), data.faqQuestions, row => row.question, row => row.total);
  }

  function drawTrend(rows, selectedIndex = chartHoverIndex) {
    const canvas = $('#trendChart');
    const empty = $('#chartEmpty');
    const tooltip = $('#trendTooltip');
    const hasData = rows.some(row => row.visits || row.subscriptions);
    if (!hasData) {
      canvas.classList.add('hidden');
      empty.classList.add('visible');
      tooltip.classList.add('hidden');
      return;
    }
    const validRows = rows;
    canvas.classList.remove('hidden');
    empty.classList.remove('visible');
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(280, canvas.clientWidth);
    const height = 230;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const pad = { top: 16, right: 42, bottom: 31, left: 42 };
    const graphWidth = width - pad.left - pad.right;
    const graphHeight = height - pad.top - pad.bottom;
    const maxVisits = Math.max(1, ...validRows.map(row => row.visits));
    const maxSubscriptions = Math.max(1, ...validRows.map(row => row.subscriptions));
    const xAt = index => pad.left + (validRows.length === 1 ? graphWidth / 2 : graphWidth * index / (validRows.length - 1));
    const yAt = (value, max) => pad.top + graphHeight * (1 - value / max);
    context.font = '10px Arial';
    context.textAlign = 'right';
    context.fillStyle = '#91897d';
    for (let tick = 0; tick <= 4; tick += 1) {
      const fraction = tick / 4;
      const y = pad.top + graphHeight * fraction;
      context.strokeStyle = '#eee9e0';
      context.beginPath();
      context.moveTo(pad.left, y);
      context.lineTo(width - pad.right, y);
      context.stroke();
      context.fillStyle = '#68816b';
      context.textAlign = 'right';
      context.fillText(numberFormat.format(Math.round(maxVisits * (1 - fraction))), pad.left - 7, y + 3);
      context.fillStyle = '#a85f42';
      context.textAlign = 'left';
      context.fillText(numberFormat.format(Math.round(maxSubscriptions * (1 - fraction))), width - pad.right + 7, y + 3);
    }
    const visitGradient = context.createLinearGradient(0, pad.top, 0, height - pad.bottom);
    visitGradient.addColorStop(0, 'rgba(80, 106, 85, 0.28)');
    visitGradient.addColorStop(1, 'rgba(80, 106, 85, 0.02)');
    context.beginPath();
    validRows.forEach((row, index) => {
      const x = xAt(index);
      const y = yAt(row.visits, maxVisits);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineTo(xAt(validRows.length - 1), height - pad.bottom);
    context.lineTo(xAt(0), height - pad.bottom);
    context.closePath();
    context.fillStyle = visitGradient;
    context.fill();
    context.beginPath();
    validRows.forEach((row, index) => {
      const x = xAt(index);
      const y = yAt(row.visits, maxVisits);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = '#506a55';
    context.lineWidth = 2.5;
    context.stroke();
    context.beginPath();
    validRows.forEach((row, index) => {
      const x = xAt(index);
      const y = yAt(row.subscriptions, maxSubscriptions);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = '#bd744b';
    context.lineWidth = 2.5;
    context.stroke();
    validRows.forEach((row, index) => {
      const x = xAt(index);
      const y = yAt(row.subscriptions, maxSubscriptions);
      context.beginPath();
      context.arc(x, y, selectedIndex === index ? 4 : 2.5, 0, Math.PI * 2);
      context.fillStyle = '#bd744b';
      context.fill();
    });
    if (selectedIndex != null && validRows[selectedIndex]) {
      context.beginPath();
      context.moveTo(xAt(selectedIndex), pad.top);
      context.lineTo(xAt(selectedIndex), height - pad.bottom);
      context.strokeStyle = '#766f6440';
      context.lineWidth = 1;
      context.stroke();
    }
    const labelCount = Math.min(6, validRows.length);
    context.fillStyle = '#91897d';
    context.textAlign = 'center';
    for (let index = 0; index < labelCount; index += 1) {
      const rowIndex = labelCount === 1 ? 0 : Math.round((validRows.length - 1) * index / (labelCount - 1));
      const row = validRows[rowIndex];
      const x = xAt(rowIndex);
      context.fillText(new Date(`${row.day}T12:00:00`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }), x, height - 8);
    }
    if (selectedIndex != null && validRows[selectedIndex]) showTrendTooltip(validRows[selectedIndex], xAt(selectedIndex), width);
    else tooltip.classList.add('hidden');
  }

  function showTrendTooltip(row, x, chartWidth) {
    const tooltip = $('#trendTooltip');
    const date = new Date(`${row.day}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    tooltip.textContent = `${date} · Visitas: ${numberFormat.format(row.visits)} · Solicitudes: ${numberFormat.format(row.subscriptions)}`;
    tooltip.style.left = `${Math.max(104, Math.min(chartWidth - 104, x))}px`;
    tooltip.classList.remove('hidden');
  }

  function renderComparison(id, currentValue, previousValue, mode = 'relative') {
    const indicator = $(`#${id}`);
    const current = Number(currentValue) || 0;
    const previous = Number(previousValue) || 0;
    indicator.className = 'trend-indicator';
    if (previous === 0) {
      indicator.classList.add(current === 0 ? 'trend-flat' : 'trend-up');
      indicator.textContent = current === 0 ? 'Sin cambio · período anterior: 0' : '↑ Nuevo · período anterior: 0';
      return;
    }
    const difference = current - previous;
    const rising = difference > 0;
    const falling = difference < 0;
    indicator.classList.add(rising ? 'trend-up' : falling ? 'trend-down' : 'trend-flat');
    if (mode === 'percentage-points') {
      const points = Math.abs(difference);
      indicator.textContent = `${rising ? '↑' : falling ? '↓' : '→'} ${points.toLocaleString('es-CO', { maximumFractionDigits: 2 })} pp vs período anterior`;
      return;
    }
    const change = Math.abs(difference / previous * 100);
    indicator.textContent = `${rising ? '↑' : falling ? '↓' : '→'} ${change.toLocaleString('es-CO', { maximumFractionDigits: 1 })}% vs período anterior`;
  }

  function chartIndexAt(event) {
    const canvas = $('#trendChart');
    const rows = state.dashboard?.timeseries || [];
    if (!rows.length) return null;
    const rect = canvas.getBoundingClientRect();
    const left = 42;
    const right = 42;
    const plotWidth = Math.max(1, rect.width - left - right);
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - left) / plotWidth));
    return Math.round(fraction * (rows.length - 1));
  }

  function renderBars(container, rows, label, value) {
    container.replaceChildren();
    const max = Math.max(1, ...rows.map(value));
    if (!rows.length) return appendEmpty(container, 'No hay visitas para mostrar.');
    const palette = ['#506a55', '#bd744b', '#76604b', '#8c9a7f'];
    rows.forEach((row, index) => {
      const item = document.createElement('div');
      item.className = 'bar-row';
      const name = document.createElement('span');
      name.textContent = label(row);
      const track = document.createElement('span');
      track.className = 'bar-track';
      const fill = document.createElement('i');
      fill.style.width = `${Math.max(3, value(row) / max * 100)}%`;
      fill.style.backgroundColor = palette[index % palette.length];
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
    const max = Math.max(1, ...rows.map(value));
    const palette = ['#506a55', '#bd744b', '#76604b', '#8c9a7f'];
    rows.forEach((row, index) => {
      const item = document.createElement('div');
      item.className = 'rank-row';
      const name = document.createElement('span');
      name.textContent = label(row);
      const total = document.createElement('b');
      total.textContent = numberFormat.format(value(row));
      const track = document.createElement('span');
      track.className = 'bar-track rank-track';
      const fill = document.createElement('i');
      fill.style.width = `${Math.max(0, value(row) / max * 100)}%`;
      fill.style.backgroundColor = palette[index % palette.length];
      track.append(fill);
      item.append(name, total, track);
      container.append(item);
    });
  }

  function renderFunnel(rows, container = $('#funnelList')) {
    container.replaceChildren();
    const max = Math.max(1, ...rows.map(row => row.total));
    const palette = ['#506a55', '#bd744b', '#76604b', '#8c9a7f'];
    rows.forEach((row, index) => {
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
      fill.style.backgroundColor = palette[index % palette.length];
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
    $('#leadCount').textContent = `${data.leads.length} contactos mostrados`;
    renderTableRows($('#leadRows'), data.leads, [
      { key: 'user_id', render: (td, row) => { td.textContent = row.user_id || 'Sin cuenta'; } },
      { key: 'name' }, { key: 'email' }, { key: 'phone' },
      { key: 'source' }, { key: 'campaign' },
      { key: 'created_at', render: (td, row) => { td.textContent = formatDate(row.created_at); } },
      { key: 'converted', render: (td, row) => {
        const badge = document.createElement('span');
        badge.className = `status-pill${row.converted ? '' : ' simulated'}`;
        badge.textContent = row.converted ? 'Envió una solicitud' : 'Sin solicitud';
        td.append(badge);
      } }
    ], 'No se encontraron contactos en el rango elegido.');
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
          row.label && `Botón: ${row.label}`,
          row.option && `Opción: ${row.option} → ${row.value || '—'}`,
          row.question && `FAQ: ${row.question}`,
          row.mode && `Ventana: ${row.mode}`,
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
  $('#filterSource').addEventListener('change', updateDimensionOptions);
  $('#filterMedium').addEventListener('change', updateDimensionOptions);
  $('#eventType').addEventListener('change', loadSection);
  $('#subscriptionPlan').addEventListener('change', loadSection);
  $('#logoutButton').addEventListener('click', logout);
  const trendCanvas = $('#trendChart');
  trendCanvas.addEventListener('pointermove', event => {
    const index = chartIndexAt(event);
    if (index == null || index === chartHoverIndex) return;
    chartHoverIndex = index;
    drawTrend(state.dashboard.timeseries, index);
  });
  trendCanvas.addEventListener('pointerleave', () => {
    chartHoverIndex = null;
    if (state.dashboard) drawTrend(state.dashboard.timeseries, null);
  });
  trendCanvas.addEventListener('focus', () => {
    if (!state.dashboard?.timeseries.length) return;
    chartHoverIndex = chartHoverIndex ?? 0;
    drawTrend(state.dashboard.timeseries, chartHoverIndex);
  });
  trendCanvas.addEventListener('blur', () => {
    chartHoverIndex = null;
    if (state.dashboard) drawTrend(state.dashboard.timeseries, null);
  });
  trendCanvas.addEventListener('keydown', event => {
    const rows = state.dashboard?.timeseries || [];
    if (!rows.length) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      chartHoverIndex = null;
      drawTrend(rows, null);
      return;
    }
    if (event.key === 'Home') chartHoverIndex = 0;
    else if (event.key === 'End') chartHoverIndex = rows.length - 1;
    else chartHoverIndex = Math.max(0, Math.min(rows.length - 1, (chartHoverIndex ?? 0) + (event.key === 'ArrowRight' ? 1 : -1)));
    drawTrend(rows, chartHoverIndex);
  });
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
