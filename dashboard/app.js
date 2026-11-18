const $ = id => document.getElementById(id);
const data = window.RADAR;
const state = { universe: 'early', band: null, sort: 'rank', descending: false, page: 1 };
const pageSize = 12;
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3, style: 'currency', currency: 'USD' });
const money = n => n == null ? '—' : compact.format(n);
const pct = n => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const multiple = n => n.toFixed(2) + '×';
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const category = row => row.category ?? 'Unclassified';
const nameSort = (a, b) => a.localeCompare(b);
const unique = values => [...new Set(values)].sort(nameSort);
const isEarly = () => state.universe === 'early';
const currentRows = () => isEarly() ? data.rows : data.reference;

const boundary = [0, 1e6, 3.162278e6, 1e7, 3.1622777e7, 1e8, 3.16227766e8, 1e9, 3.16227766e9, Infinity];
const labels = ['< $1M', '$1M', '$3.2M', '$10M', '$32M', '$100M', '$316M', '$1B', '$3.2B+'];
const bins = labels.map((label, index) => ({
  label, low: boundary[index], high: boundary[index + 1],
  description: index === 0 ? 'Below $1M' : index === labels.length - 1 ? '$3.2B and above' : label + ' to under ' + labels[index + 1].replace('+', ''),
}));
const inBin = (row, bin) => row.implied_value_usd >= bin.low && row.implied_value_usd < bin.high;

function selectOptions() {
  for (const [id, values, label] of [
    ['category', currentRows().map(category), 'All categories'],
    ['chain', currentRows().flatMap(row => row.chains), 'All chains'],
  ]) {
    $(id).replaceChildren(new Option(label, ''), ...unique(values).map(value => new Option(value, value)));
  }
}
function filtersMatch(row) {
  const query = $('search').value.trim().toLowerCase();
  return (!query || [row.name, row.slug, row.symbol].some(text => text?.toLowerCase().includes(query))) &&
    (!$('category').value || category(row) === $('category').value) &&
    (!$('chain').value || row.chains.includes($('chain').value)) &&
    (!isEarly() || !$('watch').checked || row.watchlist);
}

function renderChart(rows) {
  $('market').hidden = !isEarly();
  if (!isEarly()) return;
  const counts = bins.map(bin => {
    const group = rows.filter(row => inBin(row, bin));
    return { count: group.length, watch: group.filter(row => row.watchlist).length };
  });
  const interval = Math.max(1, Math.ceil(Math.max(...counts.map(bin => bin.count)) / 4 / 5) * 5);
  const top = interval * 4;
  $('chart').style.setProperty('--bins', bins.length);
  const lines = Array.from({ length: 5 }, (_, i) => {
    const y = (4 - i) * 25.5;
    return `<span class="gridline" style="top:${y}px"></span><span class="tick" style="top:${y}px">${interval * i}</span>`;
  });
  $('chart').innerHTML = lines.join('') + bins.map((bin, i) => {
    const { count, watch } = counts[i];
    const label = `${bin.description} · ${count} protocols · ${watch} watchlist`;
    return `<button class="bin" data-bin="${i}" style="grid-column:${i + 2}" aria-label="${label}" title="${label}" aria-pressed="${state.band === i}">
      <span class="bar" aria-hidden="true">
        ${count ? `<span class="bar-total" style="bottom:${count / top * 100}%">${count}</span>` : ''}
        <span class="bar-part bar-watch" style="height:${watch / top * 100}%"></span>
        <span class="bar-part" style="height:${(count - watch) / top * 100}%"></span>
      </span><span class="band" aria-hidden="true">${bin.label.replace('<', '&lt;')}</span>
    </button>`;
  }).join('');
}

const commonColumns = [['name', 'Protocol'], ['category', 'Category'], ['chain', 'Network'], ['tvl_usd', 'TVL', 'num'], ['change_7d', 'TVL 7d', 'num']];
const columns = () => isEarly()
  ? [['rank', 'Rank'], ...commonColumns, ['implied_value_usd', 'Implied cap', 'num'], ['spread', 'Scenario range', 'num']]
  : [...commonColumns, ['mcap_usd', 'Recorded cap', 'num']];
const chain = row => row.chains[0] ?? '—';
const sortValue = (row, key) => key === 'category' ? category(row) : key === 'chain' ? chain(row) : key === 'spread' ? row.high / row.low : row[key];
function compare(a, b) {
  const av = sortValue(a, state.sort);
  const bv = sortValue(b, state.sort);
  if (av == null) return bv == null ? nameSort(a.name, b.name) : 1;
  if (bv == null) return -1;
  const difference = typeof av === 'number' ? av - bv : nameSort(av, bv);
  return difference * (state.descending ? -1 : 1) || nameSort(a.name, b.name);
}

function rowMarkup(row) {
  const meta = isEarly() ? row.route : row.symbol ?? 'Token identifier recorded';
  const network = chain(row) + (row.chains.length > 1 ? ' +' + (row.chains.length - 1) : '');
  return `<tr>
    ${isEarly() ? `<td class="rank num">${String(row.rank).padStart(2, '0')}</td>` : ''}
    <td><button class="token-name" data-slug="${escape(row.slug)}">${escape(row.name)}${row.watchlist ? '<span title="Snapshot watchlist" aria-label="Watchlist">◆</span>' : ''}</button><span class="token-meta">${escape(meta)}</span></td>
    <td class="category">${escape(category(row))}</td><td class="chain" title="${escape(row.chains.join(', '))}">${escape(network)}</td>
    <td class="num">${money(row.tvl_usd)}</td><td class="num ${row.change_7d > 0 ? 'up' : row.change_7d < 0 ? 'down' : ''}">${pct(row.change_7d)}</td>
    <td class="num value">${money(isEarly() ? row.implied_value_usd : row.mcap_usd)}</td>
    ${isEarly() ? `<td class="num range">${money(row.low)} <span aria-hidden="true">–</span> ${money(row.high)}</td>` : ''}
  </tr>`;
}

function render() {
  const eligible = currentRows().filter(filtersMatch);
  renderChart(eligible);
  const selected = state.band === null ? null : bins[state.band];
  const rows = eligible.filter(row => !selected || inBin(row, selected)).sort(compare);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  state.page = Math.min(pages, state.page);
  const start = (state.page - 1) * pageSize;
  $('results').textContent = `${rows.length} of ${currentRows().length} protocols` +
    (selected ? ` · ${selected.description}` : '') +
    (isEarly() ? ' · ◆ Snapshot watchlist' : ' · Observed market caps where reported');
  $('head').innerHTML = '<tr>' + columns().map(([key, label, cls = '']) => {
    const sorted = state.sort === key;
    const direction = state.descending ? 'descending' : 'ascending';
    const suffix = key === 'spread' ? ' title="Sort by high-to-low ratio"' : '';
    return `<th scope="col" class="${cls}"${sorted ? ` aria-sort="${direction}"` : ''}><button data-sort="${key}"${suffix}>${label}${sorted ? state.descending ? ' ↓' : ' ↑' : ''}</button></th>`;
  }).join('') + '</tr>';
  $('rows').innerHTML = rows.slice(start, start + pageSize).map(rowMarkup).join('') ||
    `<tr><td class="empty" colspan="${columns().length}">No matches. Clear a filter or choose another valuation band.</td></tr>`;
  $('pagination').innerHTML = `<span>${rows.length ? `${start + 1}–${Math.min(start + pageSize, rows.length)} of ${rows.length}` : '0 results'}</span>
    <button data-page="-1" ${state.page === 1 ? 'disabled' : ''}>Previous</button>
    <button data-page="1" ${state.page >= pages ? 'disabled' : ''}>Next</button>`;
}

function displayPanel(label, html) {
  $('panel-label').textContent = label;
  $('panel-content').innerHTML = html;
  $('panel').scrollTop = 0;
  $('panel').showModal();
}
function openProtocol(row) {
  const title = `<h2 id="panel-title">${escape(row.name)}</h2><p class="panel-sub">${escape(category(row))} · ${escape(row.chains.join(', ') || 'Network unreported')}</p>`;
  if (!isEarly()) {
    displayPanel('TOKEN RECORDED', title + `<div class="valuation"><div><small>Recorded market cap</small><strong>${money(row.mcap_usd)}</strong></div><div><small>Snapshot TVL</small><strong>${money(row.tvl_usd)}</strong></div></div><p class="explain">Token identifier: ${escape(row.symbol ?? row.gecko_id ?? 'unreported')}. Market cap is taken from the snapshot where reported.</p>`);
    return;
  }
  const peers = row.peers.map(peer => `<li><span>${escape(peer.name)}</span><span title="TVL ${money(peer.tvl)}">${multiple(peer.ratio)}</span></li>`).join('');
  displayPanel(`RANK ${String(row.rank).padStart(2, '0')} / ${data.rows.length} · ${row.watchlist ? 'WATCHLIST' : 'EXPANDED SCAN'}`, title + `
    <div class="valuation"><div><small>Implied market cap</small><strong>${money(row.implied_value_usd)}</strong></div>
      <div><small>Scenario range</small><strong class="band-value">${money(row.low)} – ${money(row.high)}</strong></div></div>
    <div class="metrics">
      <div><small>Snapshot TVL</small><strong>${money(row.tvl_usd)}</strong></div>
      <div><small>7d TVL change</small><strong>${pct(row.change_7d)}</strong></div>
      <div><small>Days tracked</small><strong>${row.days ?? '—'}</strong></div>
      <div><small>Peer base</small><strong>${multiple(row.base)}</strong></div>
    </div>
    <p class="explain">TVL × ${multiple(row.base)} peer base × ${multiple(row.growth)} growth × ${multiple(row.seasoning)} tracking history.
      ${row.localCount ? `${escape(row.scope)} peers contribute ${Math.round(row.weight * 100)}% of the log multiple.` : 'No local peer sample. The estimate uses market-wide comparisons.'}</p>
    <details><summary>${row.localCount ? row.localCount + ' local peers + ' + row.marketCount + ' market peers' : row.marketCount + ' market peers · nearest subset shown'}</summary>
      <ul class="peer-list">${peers}</ul></details>
    <section class="plan"><h3>Farming research plan</h3>
      <div class="plan-facts"><span>${escape(row.time)} setup</span><span>${escape(row.budget)}</span></div>
      <p class="plan-note">Campaign unverified. Treat the budget as a planning cap and confirm live minimums, fees and exit terms before funding.</p>
      <ol class="plan-steps">${row.farm_steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>
    </section>`);
}

$('snapshot').textContent = 'Snapshot · ' + data.asOf;
$('source').textContent = data.source + ' · Frozen data · USD unless stated';
$('stats').innerHTML = [
  [data.rows.length, 'Ranked protocols'], [data.watchlistCount, 'Watchlist covered'], [data.peerCount, 'Eligible cap peers'],
].map(([number, label]) => `<div class="stat"><strong>${number}</strong><small>${label}</small></div>`).join('');

$('method-button').onclick = () => displayPanel('RESEARCH NOTES', `<h2 id="panel-title">Methodology</h2><div class="method-copy">
  <h3>Coverage</h3><p>All ${data.watchlistCount} supplied watchlist names appear. The expanded scan excludes token records, exchange or version-like names and selected bridge, staking-wrapper and BTC-wrapper categories. Parent-protocol links are unavailable in the snapshot. The token-recorded tab uses ticker, CoinGecko ID or positive reported cap as evidence of a record.</p>
  <h3>Peer pricing</h3><p>Start from observed market cap divided by TVL. Take the 16 closest by TVL within the category if it has four eligible names, otherwise use a related product group if it has four. Thin categories use whatever local peers exist. Compare against up to 32 distinct market peers closest by TVL. Blend medians in log space with local weight n ÷ (n + 6), then multiply by TVL.</p>
  <h3>Growth and tracking</h3><p>Seven-day TVL change moves the estimate by half that percentage, capped at ±15%. Tracking age scales the estimate from 0.90× on day zero to 1.10× after 730 days. Missing inputs contribute a neutral multiplier. Tracking age measures the DefiLlama record's history.</p>
  <h3>Scenario range</h3><p>Blend the peer 20th and 80th percentiles by the same weights. Widen each log bound by 0.25 × (1 − local weight) and by 0.15 for each missing growth or tracking input. This is a sensitivity range. Token supply, dilution, revenue, campaign eligibility and launch probability are unavailable.</p>
  <h3>Farming plans</h3><p>Time and budget are planning estimates. Protocol documentation must establish eligibility and supported actions. The radar runs offline and carries out no transactions.</p>
  </div>`);

$('close').onclick = () => $('panel').close();
$('panel').onclick = event => { if (event.target === $('panel')) $('panel').close(); };
for (const id of ['early', 'recorded']) {
  $(id).onclick = () => {
    if (state.universe === id) return;
    Object.assign(state, { universe: id, band: null, sort: id === 'early' ? 'rank' : 'mcap_usd', descending: id !== 'early', page: 1 });
    $('early').setAttribute('aria-pressed', isEarly());
    $('recorded').setAttribute('aria-pressed', !isEarly());
    $('watch-control').hidden = !isEarly();
    selectOptions();
    render();
  };
}
for (const id of ['search', 'category', 'chain', 'watch']) {
  $(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
    state.page = 1;
    render();
  });
}
$('reset').onclick = () => {
  $('search').value = $('category').value = $('chain').value = '';
  $('watch').checked = false;
  state.band = null;
  state.page = 1;
  render();
};
$('chart').onclick = event => {
  const button = event.target.closest('[data-bin]');
  if (!button) return;
  const index = Number(button.dataset.bin);
  state.band = state.band === index ? null : index;
  state.page = 1;
  render();
  $('chart').querySelector(`[data-bin="${index}"]`).focus();
};
$('head').onclick = event => {
  const key = event.target.closest('[data-sort]')?.dataset.sort;
  if (!key) return;
  state.descending = state.sort === key ? !state.descending : !['rank', 'name', 'category', 'chain'].includes(key);
  state.sort = key;
  state.page = 1;
  render();
  $('head').querySelector(`[data-sort="${key}"]`).focus();
};
$('rows').onclick = event => {
  const slug = event.target.closest('[data-slug]')?.dataset.slug;
  if (slug) openProtocol(currentRows().find(row => row.slug === slug));
};
$('pagination').onclick = event => {
  const step = Number(event.target.closest('[data-page]')?.dataset.page);
  if (!step) return;
  state.page += step;
  render();
  $('board-title').scrollIntoView({ block: 'start' });
  const button = $('pagination').querySelector(`[data-page="${step}"]:not(:disabled)`) ?? $('pagination').querySelector('button:not(:disabled)');
  button?.focus({ preventScroll: true });
};

selectOptions();
render();
