export const methodColor = (method) => {
  const colors = {
    GET: 'green',
    POST: 'blue',
    PUT: 'orange',
    PATCH: 'purple',
    DELETE: 'red',
  };
  return colors[method] || 'default';
};

export const categoryLabel = (category) => {
  const labels = {
    create: '增',
    delete: '删',
    update: '改',
    query: '查',
    mutation: '改',
    login: '登录',
    other: '其他',
  };
  return labels[category] || '其他';
};

export const statusLabel = (status) => {
  const labels = {
    created: '已创建',
    capturing: '抓包中',
    stopped: '已停止',
    pending: '等待响应',
    completed: '已完成',
    failed: '失败',
  };
  return labels[status] || status || '-';
};

export const statusClass = (status) => {
  if (['completed', 'stopped'].includes(status)) {
    return 'is-success';
  }
  if (['capturing', 'pending', 'created'].includes(status)) {
    return 'is-warning';
  }
  if (status === 'failed') {
    return 'is-danger';
  }
  return 'is-info';
};

export const prettyJson = (value) => {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch (_error) {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
};

export const shortUrl = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch (_error) {
    return url;
  }
};

export const responseStatusColor = (status) => {
  if (!status) {
    return 'default';
  }
  if (status >= 200 && status < 300) {
    return 'green';
  }
  if (status >= 300 && status < 400) {
    return 'blue';
  }
  if (status >= 400 && status < 500) {
    return 'orange';
  }
  return 'red';
};

export const formatSessionTime = (value) => {
  if (!value) {
    return '-';
  }
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch (_error) {
    return value;
  }
};

export const sessionDisplayName = (session) =>
  session.name || session.targetUrl || session.id || '未命名会话';

export const sessionOptionLabel = (session, options = {}) => {
  const name = sessionDisplayName(session);
  const counts = [`HTTP ${session.requestCount || 0}`];
  if (options.includeStatic) {
    counts.push(`静态 ${session.staticResourceCount || 0}`);
  }
  return [
    name,
    `ID: ${session.id}`,
    session.targetUrl || '无目标 URL',
    formatSessionTime(session.startedAt),
    counts.join(' / '),
  ].join(' | ');
};

export const filterSessionOption = (input, option) =>
  String(option?.label || '').toLowerCase().includes(String(input || '').toLowerCase());
