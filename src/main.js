import { createApp } from 'vue';
import Antd from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';
import './styles/index.css';
import App from './App.vue';
import siriusLogoUrl from '../docs/assets/sirius-logo.png?url';

const favicon = document.querySelector('link[rel="icon"]') || document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = siriusLogoUrl;
document.head.appendChild(favicon);

createApp(App).use(Antd).mount('#app');
