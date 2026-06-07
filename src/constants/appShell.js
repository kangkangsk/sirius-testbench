import {
  ApiOutlined,
  CloudSyncOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons-vue';

export const roleOptions = [
  { value: 'local', label: '本地工作台' },
  { value: 'tester', label: '测试执行' },
  { value: 'debug', label: '抓包调试' },
];

export const systemMenuItems = [
  { key: 'workspace', icon: FolderOpenOutlined, label: '工作空间' },
  { key: 'capture', icon: CloudSyncOutlined, label: '抓包会话' },
];

export const businessMenuItems = [
  { key: 'review', icon: ApiOutlined, label: '请求整理' },
  { key: 'auth', icon: SafetyCertificateOutlined, label: '登录态替换' },
  { key: 'replay', icon: PlayCircleOutlined, label: '回放测试' },
  { key: 'pressure', icon: ThunderboltOutlined, label: '压力测试' },
  { key: 'scripts', icon: CodeOutlined, label: '脚本导出' },
];

export const pageLabels = [...systemMenuItems, ...businessMenuItems].reduce((labels, item) => {
  labels[item.key] = item.label;
  return labels;
}, {});

export function validPageKeys() {
  return [...systemMenuItems, ...businessMenuItems].map((item) => item.key);
}

export function defaultPageKey() {
  return 'workspace';
}
