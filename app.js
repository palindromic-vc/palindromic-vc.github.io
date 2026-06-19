'use strict';

const state = {
  manifest: null,
  language: null,
  quantLang: 'english',
  quantView: 'bar',
  quantCsvText: '',
  configs: [],
  configKey: null,
  items: [],
  currentIndex: 0,
  observer: null,
};

const elements = {
  abstract: document.getElementById('abstract'),
  tabs: document.getElementById('languageTabs'),
  configTabs: document.getElementById('configTabs'),
  track: document.getElementById('carouselTrack'),
  indicator: document.getElementById('carouselIndicator'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  quantLangTabs: document.getElementById('quantLangTabs'),
};

const inputRows = [
  { key: 'source', label: 'Source', file: 'source.wav' },
  { key: 'prompt', label: 'Prompt', file: 'prompt.wav' },
];

const ablationInputRows = [
  { label: 'Source', file: 'source.wav' },
  { label: 'Prompt', file: 'prompt.wav' },
];

const ablationOutputRows = [
  { label: 'Stage 2', file: 'converted_stage2.wav' },
  { label: 'Stage 3', file: 'converted_stage3.wav' },
];

const methodLabels = {
  'palindrome-vc': 'Ours',
  'knn-vc': 'kNN-VC',
  'oovc': 'OOVC',
  'seed-vc': 'Seed-VC',
  'vevo': 'VEVO',
};

const metricLabels = {
  spk_sim: 'Speaker Similarity',
  eer: 'EER',
  wer: 'WER',
  cer: 'CER',
  mos: 'MOS',
  smos: 'SMOS',
  'dns-mos': 'DNS-MOS',
};

const metricOrder = ['spk_sim', 'eer', 'wer', 'cer', 'mos', 'smos', 'dns-mos'];

const methodOrder = ['knn-vc', 'oovc', 'seed-vc', 'vevo', 'palindrome-vc'];
const chartMethodOrder = ['knn-vc', 'oovc', 'palindrome-vc', 'seed-vc', 'vevo'];
const defaultSamplePromptDuration = '10s';

const methodColors = {
  'knn-vc': '#d67f1c',
  'oovc': '#56B8E9',
  'palindrome-vc': '#1f4fff',
  'seed-vc': '#2f8f4e',
  'vevo': '#b033aa',
};

const tocElement = document.querySelector('.toc');
const tocLinks = tocElement ? Array.from(tocElement.querySelectorAll('a')) : [];
const tocTargets = tocLinks
  .map(link => {
    const id = link.getAttribute('href');
    if (!id || !id.startsWith('#')) return null;
    const target = document.getElementById(id.slice(1));
    if (!target) return null;
    return { link, target };
  })
  .filter(Boolean);

function updateTocActive() {
  if (!tocLinks.length || !tocTargets.length) return;
  const focusOffset = 140;
  let activeLink = tocLinks[0];
  let bestDistance = Infinity;

  tocTargets.forEach(({ link, target }) => {
    const rect = target.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const distance = Math.abs(rect.top - focusOffset);
    if (distance < bestDistance) {
      bestDistance = distance;
      activeLink = link;
    }
  });

  tocLinks.forEach(link => link.classList.toggle('is-active', link === activeLink));
}

function updateTocState() {
  updateTocActive();
}

function parseTranslate(transform) {
  if (!transform) return null;
  const match = transform.match(/translate\(([-\d.]+)\s+([-\d.]+)\)/);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

function normalizeSymbolBase(text) {
  switch (text) {
    case 'A':
    case 'B':
    case 'a':
    case 'b':
      return text;
    case 'B̂':
      return 'B_hat';
    case 'Ã':
      return 'A_tilde';
    case 'ã':
      return 'a_tilde';
    default:
      return null;
  }
}

function makeSymbolKey(baseKey, sub) {
  if (!baseKey || !sub) return null;
  if (baseKey === 'B_hat') return `B_hat${sub}`;
  if (baseKey === 'A_tilde') return `A_tilde${sub}`;
  if (baseKey === 'a_tilde') return `a_tilde${sub}`;
  if (sub === 'ref') return `${baseKey}_ref`;
  return `${baseKey}${sub}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMathLabel(label) {
  if (!label) return '';
  const raw = String(label);
  if (!raw.includes('_')) {
    return `<span class="math-label">${escapeHtml(raw)}</span>`;
  }

  const parts = raw.split('_');
  let base = parts.shift() || raw;
  let diacritic = null;
  let sub = '';
  if (parts.length && ['tilde', 'hat', 'bar'].includes(parts[0])) {
    diacritic = parts.shift();
  }
  if (parts.length) {
    sub = parts.join('_');
  }

  const diacritics = {
    tilde: '\u0303',
    hat: '\u0302',
    bar: '\u0304',
  };
  const mark = diacritic ? diacritics[diacritic] || '' : '';
  const baseText = `${escapeHtml(base)}${mark}`;
  const subHtml = sub ? `<span class="math-sub">${escapeHtml(sub)}</span>` : '';
  return `<span class="math-label">${baseText}${subHtml}</span>`;
}

function formatMathInText(text) {
  if (!text) return '';
  const raw = String(text);
  const regex = /\b[A-Za-z]+(?:_(?:tilde|hat|bar))?(?:_[A-Za-z0-9]+)+\b/g;
  let result = '';
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    result += escapeHtml(raw.slice(lastIndex, match.index));
    result += formatMathLabel(match[0]);
    lastIndex = match.index + match[0].length;
  }
  result += escapeHtml(raw.slice(lastIndex));
  return result;
}

function alignPanelToTarget(panelText, target, onAligned) {
  if (!panelText || !target) return;
  const panelContainer = panelText.parentElement;
  if (!panelContainer) return;

  panelText.style.setProperty('--overview-offset', '0px');

  requestAnimationFrame(() => {
    const panelRect = panelContainer.getBoundingClientRect();
    const textRect = panelText.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    const targetCenter = targetRect.top + targetRect.height / 2;
    const desiredTop = targetCenter - textRect.height / 2;
    const minTop = panelRect.top;
    const maxTop = panelRect.bottom - textRect.height;
    const clampedTop = Math.min(Math.max(desiredTop, minTop), maxTop);
    const offset = clampedTop - textRect.top;

    panelText.style.setProperty('--overview-offset', `${offset}px`);
    if (typeof onAligned === 'function') {
      onAligned();
    }
  });
}

async function initOverviewInteractivity() {
  const figure = document.getElementById('overviewFigure');
  if (!figure) return;

  let svgText = '';
  if (window.__OVERVIEW_SVG__) {
    svgText = String(window.__OVERVIEW_SVG__);
  } else {
    try {
      const res = await fetch('static/overview.svg');
      if (res.ok) svgText = await res.text();
    } catch (err) {
      svgText = '';
    }
  }

  if (!svgText) return;

  figure.innerHTML = svgText;
  const svg = figure.querySelector('svg');
  if (!svg) return;
  svg.classList.add('overview-svg');

  let interactions = null;
  if (window.__OVERVIEW_INTERACTIONS__) {
    interactions = window.__OVERVIEW_INTERACTIONS__;
  } else {
    try {
      const res = await fetch('static/overview_interactions.json');
      if (res.ok) interactions = await res.json();
    } catch (err) {
      interactions = null;
    }
  }

  if (!interactions) return;

  const trainingPanel = document.getElementById('overviewTrainingText');
  const inferencePanel = document.getElementById('overviewInferenceText');
  const mobilePanel = document.getElementById('overviewMobileText');
  const caption = document.querySelector('.overview-caption');
  const trainingDefault = trainingPanel ? trainingPanel.textContent.trim() : '';
  const inferenceDefault = inferencePanel ? inferencePanel.textContent.trim() : '';
  const isMobileDevice = () => {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
      return navigator.userAgentData.mobile;
    }
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  };

  const instructionText = isMobileDevice()
    ? 'Tap elements to view details.'
    : 'Hover over elements to view details.';

  if (mobilePanel) {
    mobilePanel.textContent = instructionText;
  }
  if (caption) {
    caption.textContent = instructionText;
  }

  const mobileDefault = mobilePanel ? mobilePanel.textContent.trim() : '';

  const symbolMap = {
    training: new Map(),
    inference: new Map(),
  };
  const blockMap = {
    training: new Map(),
    inference: new Map(),
  };

  (interactions.symbols?.training || []).forEach(item => symbolMap.training.set(item.key, item));
  (interactions.symbols?.inference || []).forEach(item => symbolMap.inference.set(item.key, item));
  (interactions.blocks?.training || []).forEach(item => blockMap.training.set(item.key, item));
  (interactions.blocks?.inference || []).forEach(item => blockMap.inference.set(item.key, item));

  const viewBox = svg.viewBox?.baseVal;
  const midX = viewBox ? viewBox.width / 2 : 0;
  const ignoredLabels = new Set(['Training', 'Inference', 'Vocoder', 'Transformer', 'KNN', 'WAVLM']);

  const attachHover = (nodes, side, item) => {
    if (!item || !side) return;
    const panel = side === 'training' ? trainingPanel : inferencePanel;
    const fallback = side === 'training' ? trainingDefault : inferenceDefault;
    const nodeList = Array.isArray(nodes) ? nodes : [nodes];
    if (!panel) return;

    const show = () => {
      panel.innerHTML = `<strong>${formatMathLabel(item.label)}</strong>${formatMathInText(item.text)}`;
      if (mobilePanel) {
        mobilePanel.innerHTML = `<strong>${formatMathLabel(item.label)}</strong>${formatMathInText(item.text)}`;
      }
      panel.classList.remove('has-content');
      const targetNode = nodeList[0];
      if (targetNode) {
        alignPanelToTarget(panel, targetNode, () => {
          panel.classList.add('has-content');
        });
      } else {
        panel.classList.add('has-content');
      }
      if (mobilePanel) {
        mobilePanel.classList.add('has-content');
      }
      nodeList.forEach(node => node.classList.add('overview-interactive', 'is-active'));
    };
    const hide = () => {
      panel.textContent = fallback || '';
      if (mobilePanel) {
        mobilePanel.textContent = mobileDefault || '';
      }
      panel.style.setProperty('--overview-offset', '0px');
      panel.classList.remove('has-content');
      if (mobilePanel) {
        mobilePanel.classList.remove('has-content');
      }
      nodeList.forEach(node => node.classList.remove('is-active'));
    };

    nodeList.forEach(node => {
      node.classList.add('overview-interactive');
      node.addEventListener('mouseenter', show);
      node.addEventListener('mouseleave', hide);
    });
  };

  const blockLabels = new Set(['Vocoder', 'Transformer', 'KNN', 'WAVLM']);
  const blockGroups = Array.from(svg.querySelectorAll('g')).filter(group => {
    const label = group.querySelector('text');
    return label && blockLabels.has(label.textContent.trim());
  });

  blockGroups.forEach(group => {
    const labelNode = group.querySelector('text');
    if (!labelNode) return;
    const label = labelNode.textContent.trim();
    const box = group.getBBox();
    const side = box.x + box.width / 2 < midX ? 'training' : 'inference';
    let key = null;

    if (label === 'Vocoder') {
      key = side === 'training' ? 'vocoder_train_left' : 'vocoder_infer';
    } else if (label === 'Transformer') {
      key = side === 'training' ? 'transformer_train_left' : 'transformer_infer';
    } else if (label === 'KNN') {
      key = 'knn_train';
    } else if (label === 'WAVLM') {
      key = side === 'training' ? 'wavlm_train' : 'wavlm_infer';
    }

    const item = key ? blockMap[side]?.get(key) || blockMap.training.get(key) : null;
    attachHover(group, side, item);
  });

  const textNodes = Array.from(svg.querySelectorAll('text'));
  const baseTexts = [];
  const subTexts = [];

  textNodes.forEach(node => {
    const text = node.textContent.trim();
    if (!text || ignoredLabels.has(text)) return;
    const transform = node.getAttribute('transform') || '';
    if (transform.includes('scale(.58)')) {
      subTexts.push(node);
    } else {
      baseTexts.push(node);
    }
  });

  const baseInfo = baseTexts.map(node => {
    const pos = parseTranslate(node.getAttribute('transform'));
    return { node, text: node.textContent.trim(), x: pos?.x ?? 0, y: pos?.y ?? 0 };
  });
  const subInfo = subTexts.map(node => {
    const pos = parseTranslate(node.getAttribute('transform'));
    return { node, text: node.textContent.trim(), x: pos?.x ?? 0, y: pos?.y ?? 0 };
  });

  subInfo.forEach(sub => {
    let closest = null;
    let bestDistance = Infinity;
    baseInfo.forEach(base => {
      const dx = base.x - sub.x;
      const dy = base.y - sub.y;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDistance) {
        bestDistance = dist;
        closest = base;
      }
    });
    if (!closest || bestDistance > 15) return;
    const baseKey = normalizeSymbolBase(closest.text);
    const symbolKey = makeSymbolKey(baseKey, sub.text);
    if (!symbolKey) return;

    const side = closest.x < midX ? 'training' : 'inference';
    const item = symbolMap[side]?.get(symbolKey);
    if (!item) return;
    attachHover([closest.node, sub.node], side, item);
  });
}

const chartMeta = {
  spk_sim: { id: 'spk_sim', title: 'Speaker Similarity', yLabel: 'Speaker Similarity' },
  eer: { id: 'eer', title: 'EER', yLabel: 'EER' },
  wer: { id: 'wer', title: 'WER', yLabel: 'WER' },
  cer: { id: 'cer', title: 'CER', yLabel: 'CER' },
  mos: { id: 'mos', title: 'MOS', yLabel: 'MOS' },
  smos: { id: 'smos', title: 'SMOS', yLabel: 'SMOS' },
  'dns-mos': { id: 'dns-mos', title: 'DNS-MOS', yLabel: 'DNS-MOS' },
};

function formatLangLabel(lang) {
  if (!lang) return '';
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}

function getQuantCsvMap() {
  const map = {};
  if (window.__QUANT_ENGLISH_CSV__) map.english = String(window.__QUANT_ENGLISH_CSV__);
  if (window.__QUANT_MULTILINGUAL_CSV__) map.multilingual = String(window.__QUANT_MULTILINGUAL_CSV__);
  if (window.__QUANT_LANG_CSVS__) {
    Object.entries(window.__QUANT_LANG_CSVS__).forEach(([lang, csv]) => {
      map[lang] = String(csv);
    });
  }
  return map;
}

function getChartMetricOrder() {
  if (state.quantLang === 'english') {
    return ['spk_sim', 'wer', 'mos', 'smos'];
  }
  return ['spk_sim', 'wer', 'dns-mos'];
}

function getChartMethodOrder() {
  return chartMethodOrder;
}

async function loadAbstract() {
  if (window.__ABSTRACT__) {
    const text = String(window.__ABSTRACT__);
    elements.abstract.textContent = text.trim() || 'Add abstract text in ABSTRACT.TXT.';
    return;
  }
  try {
    const res = await fetch('ABSTRACT.TXT');
    const text = await res.text();
    elements.abstract.textContent = text.trim() || 'Add abstract text in ABSTRACT.TXT.';
  } catch (err) {
    elements.abstract.textContent = 'Add abstract text in ABSTRACT.TXT.';
  }
}

function parseCsv(text) {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(','));
}

function normalizeQuantData(csvText) {
  const rows = parseCsv(csvText);
  const header = rows.shift();
  if (!header || header.length < 4) return null;

  const durationsSet = new Set();
  const metricsSet = new Set();
  const dataByMetric = {};

  rows.forEach(row => {
    const [metric, duration, method, value] = row;
    if (!metric || !duration || !method) return;
    const metricKey = metric.trim();
    const durationValue = Number(duration);
    const val = Number(value);
    if (Number.isNaN(durationValue) || Number.isNaN(val)) return;
    metricsSet.add(metricKey);
    durationsSet.add(durationValue);
    if (!dataByMetric[metricKey]) dataByMetric[metricKey] = {};
    if (!dataByMetric[metricKey][method]) dataByMetric[metricKey][method] = {};
    dataByMetric[metricKey][method][durationValue] = val;
  });

  const durations = Array.from(durationsSet).sort((a, b) => a - b);
  const ordered = [];
  metricOrder.forEach(metric => {
    if (metricsSet.has(metric)) ordered.push(metric);
  });
  Array.from(metricsSet)
    .filter(metric => !ordered.includes(metric))
    .sort((a, b) => a.localeCompare(b))
    .forEach(metric => ordered.push(metric));

  const metrics = ordered;

  const methods = methodOrder.map(key => ({
    key,
    label: key === 'palindrome-vc' ? 'Ours' : methodLabels[key] || key,
    color: methodColors[key] || '#000',
  }));

  return { durations, metrics, methods, dataByMetric };
}

function buildChartsFromQuant(data, metricOrderOverride, methodOrderOverride) {
  const metrics = metricOrderOverride && metricOrderOverride.length
    ? metricOrderOverride.filter(metric => data.metrics.includes(metric))
    : data.metrics;

  const methodOrderForCharts = methodOrderOverride && methodOrderOverride.length
    ? methodOrderOverride
    : methodOrder;

  const methodsForCharts = methodOrderForCharts.map(key => ({
    key,
    label: key === 'palindrome-vc' ? 'Ours' : methodLabels[key] || key,
    color: methodColors[key] || '#000',
  }));

  const charts = metrics.map(metric => {
    const meta = chartMeta[metric] || { id: metric, title: metricLabels[metric] || metric, yLabel: metricLabels[metric] || metric };
    const metricData = data.dataByMetric[metric] || {};
    const series = {};
    methodOrderForCharts.forEach(methodKey => {
      series[methodKey] = data.durations.map(duration => {
        const values = metricData[methodKey] || {};
        return values[duration];
      });
    });

    const values = [];
    methodOrderForCharts.forEach(methodKey => {
      series[methodKey].forEach(val => {
        if (val !== undefined) values.push(val);
      });
    });
    let yMin = Math.min(...values);
    let yMax = Math.max(...values);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin = yMin * 0.9;
      yMax = yMax * 1.1;
    } else {
      const pad = (yMax - yMin) * 0.1;
      yMin -= pad;
      yMax += pad;
    }
    if (['wer', 'cer', 'eer'].includes(metric)) {
      yMin = Math.min(0, yMin);
    }

    return { ...meta, yMin, yMax, data: series };
  });

  return { durations: data.durations, methods: methodsForCharts, charts };
}

function renderQuantTable(csvText) {
  if (!csvText) return;
  const data = normalizeQuantData(csvText);
  if (!data) return;

  const formatValue = value => {
    if (value === undefined || value === null || Number.isNaN(value)) return '-';
    return Number(value).toFixed(3);
  };

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const headers = ['Model', 'Prompt Dur. (s)', ...data.metrics.map(metric => metricLabels[metric] || metric)];
  headers.forEach((header, index) => {
    const th = document.createElement('th');
    th.textContent = header;
    if (index === 0) th.classList.add('model');
    if (index === 1) th.classList.add('duration');
    if (index >= 2) th.classList.add('numeric');
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  data.methods.forEach(method => {
    data.durations.forEach(duration => {
      const tr = document.createElement('tr');
      const modelCell = document.createElement('td');
      modelCell.textContent = method.label;
      modelCell.classList.add('model');
      tr.appendChild(modelCell);

      const durationCell = document.createElement('td');
      durationCell.textContent = duration;
      durationCell.classList.add('numeric', 'duration');
      tr.appendChild(durationCell);

      data.metrics.forEach(metric => {
        const td = document.createElement('td');
        const values = data.dataByMetric[metric] || {};
        const methodValues = values[method.key] || {};
        const value = methodValues[duration];
        td.textContent = formatValue(value);
        td.classList.add('numeric');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  });
  table.appendChild(tbody);

  const container = document.getElementById('quantTable');
  if (container) {
    container.innerHTML = '';
    container.appendChild(table);
  }
}

function renderLegend(methods) {
  const legend = document.getElementById('quantLegend');
  if (!legend) return;
  legend.innerHTML = '';
  methods.forEach(method => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = method.color;
    const label = document.createElement('span');
    label.textContent = method.label;
    item.appendChild(swatch);
    item.appendChild(label);
    legend.appendChild(item);
  });
}

function renderCharts(data) {
  const container = document.getElementById('quantCharts');
  if (!container) return;
  container.innerHTML = '';

  const methods = data.methods || [];
  const durations = data.durations || [];

  data.charts.forEach(chart => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart';

    const title = document.createElement('div');
    title.className = 'chart-title';
    title.textContent = chart.title;
    wrapper.appendChild(title);

    const svg = buildBarChartSvg({
      chart,
      methods,
      durations,
      width: 360,
      height: 240,
      margin: { top: 12, right: 8, bottom: 28, left: 36 },
    });
    wrapper.appendChild(svg);

    container.appendChild(wrapper);
  });
}

function buildBarChartSvg({ chart, methods, durations, width, height, margin }) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', chart.title);

  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const yMin = chart.yMin;
  const yMax = chart.yMax;
  const range = yMax - yMin || 1;
  const groupWidth = plotWidth / durations.length;
  const barWidth = Math.min(16, (groupWidth - 12) / methods.length);
  const y0 = margin.top + plotHeight;

  const yScale = value => {
    const t = (value - yMin) / range;
    return y0 - t * plotHeight;
  };

  const makeLine = (x1, y1, x2, y2, opacity = 0.2) => {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', '#111');
    line.setAttribute('stroke-opacity', opacity);
    line.setAttribute('stroke-width', 0.5);
    svg.appendChild(line);
  };

  const ticks = 3;
  for (let i = 0; i <= ticks; i += 1) {
    const value = yMin + (range * i) / ticks;
    const y = yScale(value);
    makeLine(margin.left, y, width - margin.right, y, i === 0 ? 0.35 : 0.15);

    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', margin.left - 6);
    label.setAttribute('y', y + 4);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('font-size', '10');
    label.setAttribute('fill', '#6b6b6b');
    label.textContent = value.toFixed(2);
    svg.appendChild(label);
  }

  durations.forEach((duration, groupIndex) => {
    const groupStart = margin.left + groupIndex * groupWidth;
    const totalBarsWidth = methods.length * barWidth;
    const offset = (groupWidth - totalBarsWidth) / 2;

    methods.forEach((method, methodIndex) => {
      const values = chart.data[method.key] || [];
      const value = values[groupIndex];
      if (value === undefined) return;
      const x = groupStart + offset + methodIndex * barWidth;
      const y = yScale(value);
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barWidth - 1);
      rect.setAttribute('height', y0 - y);
      rect.setAttribute('fill', method.color);
      svg.appendChild(rect);
    });

    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', groupStart + groupWidth / 2);
    label.setAttribute('y', height - 8);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '10');
    label.setAttribute('fill', '#6b6b6b');
    label.textContent = duration;
    svg.appendChild(label);
  });

  return svg;
}

async function loadQuantCharts() {
  const legend = document.getElementById('quantLegend');
  const container = document.getElementById('quantCharts');

  const csvText = state.quantCsvText;
  if (!csvText) {
    if (legend) legend.textContent = 'Unable to load chart data.';
    if (container) container.innerHTML = '';
    return;
  }
  const data = normalizeQuantData(csvText);
  if (!data) {
    if (legend) legend.textContent = 'Unable to parse chart data.';
    if (container) container.innerHTML = '';
    return;
  }
  const chartData = buildChartsFromQuant(data, getChartMetricOrder(), getChartMethodOrder());
  renderLegend(chartData.methods || []);
  renderCharts(chartData);
}

async function getQuantCsvText(lang) {
  const map = getQuantCsvMap();
  if (map[lang]) return map[lang];
  const path = lang === 'english' || lang === 'multilingual'
    ? `static/quant_${lang}.csv`
    : `static/quant_lang_${lang}.csv`;
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error('CSV fetch failed');
    return await res.text();
  } catch (err) {
    return '';
  }
}

function renderQuantSection() {
  const legend = document.getElementById('quantLegend');
  const charts = document.getElementById('quantCharts');
  const table = document.getElementById('quantTable');
  const subtitle = document.getElementById('quantSubtitle');

  if (!state.quantCsvText) {
    if (legend) legend.textContent = 'Unable to load quantitative data.';
    if (table) table.textContent = 'Unable to load quantitative results.';
    if (subtitle) subtitle.textContent = '';
    return;
  }
  renderQuantTable(state.quantCsvText);

  if (charts) {
    charts.dataset.layout = state.quantLang === 'english' ? 'english' : 'multi';
  }

  if (subtitle) {
    subtitle.textContent = state.quantLang === 'multilingual'
      ? 'Averaged across all non-english languages'
      : '';
  }

  if (state.quantView === 'bar') {
    loadQuantCharts();
    if (legend) {
      legend.classList.remove('is-hidden');
      legend.hidden = false;
    }
    if (charts) {
      charts.classList.remove('is-hidden');
      charts.hidden = false;
    }
  } else {
    if (legend) {
      legend.classList.add('is-hidden');
      legend.hidden = true;
      legend.innerHTML = '';
    }
    if (charts) {
      charts.classList.add('is-hidden');
      charts.hidden = true;
      charts.innerHTML = '';
    }
  }

  if (table) {
    table.classList.toggle('is-hidden', state.quantView !== 'table');
    table.hidden = state.quantView !== 'table';
  }
}

async function setQuantLang(lang) {
  state.quantLang = lang;
  const langButtons = document.querySelectorAll('[data-quant-lang]');
  langButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.quantLang === lang));
  state.quantCsvText = await getQuantCsvText(lang);
  renderQuantSection();
}

function renderQuantLangTabs() {
  const container = elements.quantLangTabs;
  if (!container) return;
  container.innerHTML = '';

  const map = getQuantCsvMap();
  const extraLangs = Object.keys(map).filter(lang => !['english', 'multilingual'].includes(lang)).sort();
  const langs = ['english', 'multilingual', ...extraLangs];

  langs.forEach(lang => {
    const btn = document.createElement('button');
    btn.className = 'tab quant-tab';
    btn.type = 'button';
    btn.dataset.quantLang = lang;
    btn.textContent = lang === 'multilingual' ? 'Multilingual' : formatLangLabel(lang);
    btn.addEventListener('click', () => setQuantLang(lang));
    container.appendChild(btn);
  });
}

function setQuantView(view) {
  state.quantView = view;
  const viewButtons = document.querySelectorAll('[data-quant-view]');
  viewButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.quantView === view));
  if (state.quantCsvText) {
    renderQuantSection();
  }
}

async function loadManifest() {
  if (window.__MANIFEST__) {
    state.manifest = window.__MANIFEST__;
    return;
  }
  try {
    const res = await fetch('static/manifest.json');
    if (!res.ok) throw new Error('Manifest fetch failed');
    state.manifest = await res.json();
  } catch (err) {
    state.manifest = null;
  }
}

function sortLanguages(langs) {
  return langs.sort((a, b) => {
    if (a === 'english') return -1;
    if (b === 'english') return 1;
    return a.localeCompare(b);
  });
}

function parseSeedName(seedName) {
  const match = seedName.match(/^(.*)_seed_(\d+)$/);
  if (!match) return null;
  return { base: match[1], seedId: match[2] };
}

function formatBase(base) {
  return base.replace(/_/g, ' ');
}

function formatConfigLabel(base) {
  if (!base) return '';
  const durationMatch = base.match(/(\d+)s$/) || base.match(/_test_set_(\d+)s/);
  if (durationMatch) {
    return `${durationMatch[1]} sec. prompt`;
  }
  return formatBase(base);
}

function createTab(lang) {
  const button = document.createElement('button');
  button.className = 'tab';
  button.dataset.lang = lang;
  button.textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
  button.addEventListener('click', () => setLanguage(lang));
  return button;
}

function setLanguage(lang) {
  state.language = lang;
  [...elements.tabs.children].forEach(tab => {
    tab.classList.toggle('active', tab.dataset.lang === lang);
  });
  buildConfigs();
  renderConfigTabs();
  if (state.configs.length) {
    setConfig(getDefaultConfigKey());
  } else {
    state.items = [];
    renderCarousel();
  }
}

function getDefaultConfigKey() {
  const defaultConfig = state.configs.find(config => config.key === defaultSamplePromptDuration);
  return defaultConfig ? defaultConfig.key : state.configs[0].key;
}

function buildConfigs() {
  const data = state.manifest.languages[state.language];
  if (!data) {
    state.configs = [];
    state.items = [];
    return;
  }

  if (data.configs) {
    const configs = [];
    const keys = Object.keys(data.configs).sort((a, b) => {
      const aNum = Number((a.match(/(\d+)/) || [])[1]);
      const bNum = Number((b.match(/(\d+)/) || [])[1]);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) {
        return aNum - bNum;
      }
      return a.localeCompare(b);
    });

    keys.forEach(key => {
      const sampleIds = (data.configs[key] || []).slice().sort((a, b) => Number(a) - Number(b));
      const seedId = '0';
      const seeds = {
        [seedId]: {
          seedName: key,
          sampleIds,
        },
      };
      const sampleItems = sampleIds.map(sampleId => ({ seedId, sampleId }));
      configs.push({
        key,
        label: formatConfigLabel(key),
        seedIds: [seedId],
        seeds,
        sampleItems,
      });
    });

    state.configs = configs;
    state.items = [];
    return;
  }

  const groups = {};
  const seeds = data.seeds || {};

  Object.entries(seeds).forEach(([seedName, sampleIds]) => {
    const parsed = parseSeedName(seedName);
    if (!parsed) return;
    const { base, seedId } = parsed;
    if (!groups[base]) {
      groups[base] = {
        seeds: {},
        sampleIds: new Set(),
      };
    }
    groups[base].seeds[seedId] = { seedName, sampleIds };
    sampleIds.forEach(id => groups[base].sampleIds.add(id));
  });

  const baseKeys = Object.keys(groups).sort((a, b) => {
    const aMatch = a.match(/_test_set_(\d+)s/);
    const bMatch = b.match(/_test_set_(\d+)s/);
    if (aMatch && bMatch) {
      const diff = Number(aMatch[1]) - Number(bMatch[1]);
      if (diff !== 0) return diff;
    }
    return a.localeCompare(b);
  });

  const items = [];
  const configs = [];
  baseKeys.forEach(base => {
    const group = groups[base];
    const seedIds = Object.keys(group.seeds)
      .sort((a, b) => Number(a) - Number(b))
      .slice(0, 3);
    const sampleItems = [];
    seedIds.forEach(seedId => {
      const seedInfo = group.seeds[seedId];
      if (!seedInfo) return;
      const orderedSamples = [...seedInfo.sampleIds].sort((a, b) => Number(a) - Number(b));
      orderedSamples.forEach(sampleId => {
        sampleItems.push({ seedId, sampleId });
      });
    });
    configs.push({
      key: base,
      label: formatConfigLabel(base),
      seedIds,
      seeds: group.seeds,
      sampleItems,
    });
  });

  state.configs = configs;
  state.items = [];
}

function renderConfigTabs() {
  elements.configTabs.innerHTML = '';
  state.configs.forEach(config => {
    const button = document.createElement('button');
    button.className = 'subtab';
    button.dataset.config = config.key;
    button.textContent = config.label;
    button.addEventListener('click', () => setConfig(config.key));
    elements.configTabs.appendChild(button);
  });
}

function setConfig(key) {
  state.configKey = key;
  const config = state.configs.find(item => item.key === key);
  if (!config) {
    state.items = [];
  } else {
    state.items = config.sampleItems.map(item => ({
      base: config.key,
      seedIds: [item.seedId],
      seeds: config.seeds,
      sampleId: item.sampleId,
    }));
  }
  [...elements.configTabs.children].forEach(tab => {
    tab.classList.toggle('active', tab.dataset.config === key);
  });
  renderCarousel();
}

function buildCell(text, className) {
  const cell = document.createElement('div');
  cell.className = `grid-cell ${className || ''}`.trim();
  cell.textContent = text;
  return cell;
}

function buildAudioCell(src) {
  const cell = document.createElement('div');
  cell.className = 'grid-cell';

  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'none';
  audio.src = src;
  audio.addEventListener('error', () => {
    cell.classList.add('missing');
  });

  cell.appendChild(audio);
  return cell;
}

function buildAblationGrid({ title, rows, sampleId }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'sample-section';

  const heading = document.createElement('div');
  heading.className = 'section-title';
  heading.textContent = title;
  wrapper.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'sample-grid';
  grid.style.setProperty('--seed-count', 1);

  rows.forEach(row => {
    grid.appendChild(buildCell(row.label, 'grid-label'));
    const basePath = `static/ablation/${sampleId}`;
    grid.appendChild(buildAudioCell(`${basePath}/${row.file}`));
  });

  wrapper.appendChild(grid);
  return wrapper;
}

async function getAblationSampleIds() {
  if (window.__ABLATION_SAMPLES__) {
    return window.__ABLATION_SAMPLES__;
  }
  try {
    const res = await fetch('static/ablation/manifest.json');
    if (!res.ok) throw new Error('manifest missing');
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

async function renderAblationSamples() {
  const track = document.getElementById('ablationTrack');
  const prevBtn = document.getElementById('ablationPrevBtn');
  const nextBtn = document.getElementById('ablationNextBtn');
  const indicator = document.getElementById('ablationIndicator');
  if (!track || !prevBtn || !nextBtn || !indicator) return;
  const sampleIds = await getAblationSampleIds();
  track.innerHTML = '';

  if (!sampleIds.length) {
    const empty = document.createElement('div');
    empty.className = 'carousel-item';
    empty.textContent = 'No ablation samples found.';
    track.appendChild(empty);
    indicator.textContent = '0 / 0';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  let currentIndex = 0;

  sampleIds.forEach((sampleId, index) => {
    const item = document.createElement('div');
    item.className = 'carousel-item ablation-item';
    item.dataset.index = String(index);

    item.appendChild(buildAblationGrid({ title: 'Inputs', rows: ablationInputRows, sampleId }));
    item.appendChild(buildAblationGrid({ title: 'Outputs', rows: ablationOutputRows, sampleId }));

    track.appendChild(item);
  });

  const updateControls = () => {
    indicator.textContent = `${currentIndex + 1} / ${sampleIds.length}`;
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= sampleIds.length - 1;
  };

  const scrollToIndex = index => {
    const card = track.querySelector(`[data-index=\"${index}\"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index = Number(entry.target.dataset.index);
          if (!Number.isNaN(index)) {
            currentIndex = index;
            updateControls();
          }
        }
      });
    },
    { root: track, threshold: 0.6 }
  );

  [...track.children].forEach(child => {
    if (child.dataset.index) {
      observer.observe(child);
    }
  });

  prevBtn.addEventListener('click', event => {
    event.preventDefault();
    const next = Math.max(0, currentIndex - 1);
    scrollToIndex(next);
  });

  nextBtn.addEventListener('click', event => {
    event.preventDefault();
    const next = Math.min(sampleIds.length - 1, currentIndex + 1);
    scrollToIndex(next);
  });

  updateControls();
}

function buildGrid({ title, rows, seedIds, seeds, sampleId }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'sample-section';

  const heading = document.createElement('div');
  heading.className = 'section-title';
  heading.textContent = title;
  wrapper.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'sample-grid';
  grid.style.setProperty('--seed-count', seedIds.length);

  rows.forEach(row => {
    grid.appendChild(buildCell(row.label, 'grid-label'));
    seedIds.forEach(seedId => {
      const seedInfo = seeds[seedId];
      if (!seedInfo) {
        const missing = buildCell('Missing', '');
        missing.classList.add('missing');
        grid.appendChild(missing);
        return;
      }
      const basePath = `static/${state.language}/${seedInfo.seedName}/${sampleId}`;
      const file = row.file ? row.file : `${row.key}_converted.wav`;
      grid.appendChild(buildAudioCell(`${basePath}/${file}`));
    });
  });

  wrapper.appendChild(grid);
  return wrapper;
}

function renderCarousel() {
  elements.track.innerHTML = '';
  state.currentIndex = 0;

  if (state.observer) {
    state.observer.disconnect();
  }

  const methods = methodOrder
    .filter(key => (state.manifest.methods || []).includes(key))
    .map(key => ({
      key,
      label: methodLabels[key] || key,
    }));

  state.items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'carousel-item';
    card.dataset.index = index;

    // No per-sample title/header.

    card.appendChild(
      buildGrid({
        title: 'Inputs',
        rows: inputRows,
        seedIds: item.seedIds,
        seeds: item.seeds,
        sampleId: item.sampleId,
      })
    );

    card.appendChild(
      buildGrid({
        title: 'Outputs',
        rows: methods,
        seedIds: item.seedIds,
        seeds: item.seeds,
        sampleId: item.sampleId,
      })
    );

    elements.track.appendChild(card);
  });

  if (!state.items.length) {
    const empty = document.createElement('div');
    empty.className = 'carousel-item';
    empty.textContent = 'No samples found for this selection.';
    elements.track.appendChild(empty);
  }

  state.observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index = Number(entry.target.dataset.index);
          if (!Number.isNaN(index)) {
            state.currentIndex = index;
            updateControls();
          }
        }
      });
    },
    { root: elements.track, threshold: 0.6 }
  );

  [...elements.track.children].forEach(child => {
    if (child.dataset.index) {
      state.observer.observe(child);
    }
  });

  updateControls();
}

function scrollToIndex(index) {
  const card = elements.track.querySelector(`[data-index="${index}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function updateControls() {
  const total = state.items.length;
  elements.indicator.textContent = total ? `${state.currentIndex + 1} / ${total}` : '0 / 0';
  elements.prevBtn.disabled = state.currentIndex <= 0;
  elements.nextBtn.disabled = state.currentIndex >= total - 1;
}

elements.prevBtn.addEventListener('click', event => {
  event.preventDefault();
  const next = Math.max(0, state.currentIndex - 1);
  scrollToIndex(next);
});

elements.nextBtn.addEventListener('click', event => {
  event.preventDefault();
  const next = Math.min(state.items.length - 1, state.currentIndex + 1);
  scrollToIndex(next);
});

function initMathToggle() {
  const toggles = Array.from(document.querySelectorAll('.math-toggle[aria-controls]'));
  if (!toggles.length) return;

  const typesetMath = block => {
    if (!window.MathJax) return;
    const runTypeset = () => {
      if (typeof window.MathJax.typesetPromise === 'function') {
        window.MathJax.typesetPromise([block]).catch(() => {});
      }
    };

    if (window.MathJax.startup && window.MathJax.startup.promise) {
      window.MathJax.startup.promise.then(runTypeset).catch(() => {});
    } else {
      runTypeset();
    }
  };

  toggles.forEach(toggle => {
    const block = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!block) return;

    const setExpanded = expanded => {
      block.hidden = !expanded;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Hide math' : 'Show math';

      if (expanded && !block.querySelector('mjx-container')) {
        typesetMath(block);
      }
    };

    setExpanded(false);
    toggle.addEventListener('click', () => {
      setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
    });
  });
}

async function init() {
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  initMathToggle();
  updateTocState();
  window.addEventListener('scroll', updateTocState, { passive: true });
  await initOverviewInteractivity();
  await loadAbstract();
  await renderAblationSamples();
  const quantViewButtons = document.querySelectorAll('[data-quant-view]');

  renderQuantLangTabs();

  quantViewButtons.forEach(btn => {
    btn.addEventListener('click', () => setQuantView(btn.dataset.quantView));
  });

  setQuantView(state.quantView);
  await setQuantLang(state.quantLang);

  // Activate the correct language tab after initial render.
  const langButtons = document.querySelectorAll('[data-quant-lang]');
  langButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.quantLang === state.quantLang));

  await loadManifest();

  if (!state.manifest || !state.manifest.languages) {
    elements.track.innerHTML = '<div class="carousel-item">Unable to load manifest. Try running a local server instead of opening the file directly.</div>';
    return;
  }

  const languages = sortLanguages(Object.keys(state.manifest.languages));
  languages.forEach(lang => {
    elements.tabs.appendChild(createTab(lang));
  });

  if (languages.length) {
    setLanguage(languages[0]);
  }
}

init();
